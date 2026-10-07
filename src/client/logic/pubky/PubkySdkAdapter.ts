import "client-only";

import {
  Keypair,
  type AuthFlow,
  AuthFlowKind,
  Pubky,
  PublicKey,
  type PubkyError,
  type Session,
  type SessionStorage,
  GrantAuthFlow,
  type BrowserSessionStore,
  type Address,
  type Path,
  type Capabilities,
  Client,
  type PublicStorage,
} from "@synonymdev/pubky";
import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";
import {
  AVATAR_TYPES,
  grantsCapabilities,
  MAX_AVATAR_BYTES,
  PROFILE_CAPABILITIES,
  sniffImageType,
  type ProfileWrite,
} from "../profile/profile";
import type { KeychainAuthMethod } from "./keychainAuthMethod";
import { pubkyNetwork } from "./pubkyNetwork";
import {
  holdDelegatedKeys,
  whenDelegatedKeysUnused,
  type DelegatedKeyRelease,
} from "./delegatedGrantKeys";
import {
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
  type PubkyIdentityKeyHandle,
  type PubkyIdentityKeysErrorCode,
  type PubkyIdentityKeysResult,
  type PubkyHomeserverResolutionResult,
  type PubkyPublicIdentity,
  type PubkySecretKeyMaterial,
} from "./pubkyIdentityKey";

export type PubkyAuthenticatedIdentity = {
  publicIdentity: PubkyPublicIdentity;
};

type PubkySessionAccessErrorCode =
  | "account_exists"
  | "invalid_homeserver_pubky"
  | "key_unavailable"
  | "signin_failed"
  | "signup_failed"
  | "signup_uncertain";
export type PubkySessionAccessResult<Success> = ResultType<
  Success,
  CodedFailure<PubkySessionAccessErrorCode>
>;
type PubkyPublicationErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "publish_failed";
export type PubkyPublicationResult = ResultType<void, CodedFailure<PubkyPublicationErrorCode>>;
type PubkyRecoveryFileErrorCode =
  "invalid_passphrase" | "invalid_secret_key" | "key_unavailable" | "recovery_file_failed";
export type PubkyRecoveryFileResult = ResultType<
  Uint8Array,
  CodedFailure<PubkyRecoveryFileErrorCode>
>;
export type PubkyAuthApprovalErrorCode = "approval_failed" | "key_unavailable" | "request_rejected";
export type PubkyAuthApprovalResult = ResultType<void, CodedFailure<PubkyAuthApprovalErrorCode>>;

type Signer = ReturnType<Pubky["signer"]>;
type PublicKeyParseResult<ErrorCode extends string> = ResultType<
  PublicKey,
  CodedFailure<ErrorCode>
>;
const PASSPORT_CLIENT_ID = "passport.pubky.app";

/**
 * Owns one SDK keypair while handing an identity to Pubky Ring.
 *
 * The {@link url} embeds the full exported secret key. Treat it as secret material: never log,
 * persist, or hold it in application state. Rendering it is the one intentional exception to
 * "secrets never enter render output", because a QR code must contain the secret. {@link navigate} disposes the handle after
 * attempting the browser handoff; callers that only inspect the URL or abandon the handoff must
 * call {@link dispose} themselves.
 */
export class PubkyRingMigration {
  private keypair: Keypair | null;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
  }

  /** Idempotently releases the SDK keypair owned by this migration. */
  dispose(): void {
    const keypair = this.keypair;
    if (!keypair) return;
    this.keypair = null;
    cleanup("create_pubky_ring_migration", "keypair_free", () => keypair.free());
  }

  /**
   * Attempts the Pubky Ring handoff and consumes the migration after a navigation attempt. The
   * secret-bearing link is followed through a hidden link clicked within the person's press and
   * removed at once, never assigned to this page's location, so it never becomes the page's
   * address or a history entry; a phone hands an app scheme on only from such a top-level
   * navigation, not from a frame.
   */
  navigate(): boolean {
    const migrationUrl = this.url;
    if (!migrationUrl) return false;
    const link = globalThis.document.createElement("a");
    try {
      link.href = migrationUrl;
      link.rel = "noopener noreferrer";
      link.hidden = true;
      globalThis.document.body.append(link);
      link.click();
      return true;
    } finally {
      link.remove();
      link.removeAttribute("href");
      this.dispose();
    }
  }

  /** Returns the secret-bearing handoff URL, or `null` after the migration is disposed. */
  get url(): string | null {
    if (!this.keypair) return null;
    const exportedSecret = this.keypair.secret();
    try {
      // Ring strips its scheme before routing this SDK secret to normal single-identity import.
      const secretKeyHex = Array.from(exportedSecret, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      return `pubkyring://${secretKeyHex}`;
    } finally {
      exportedSecret.fill(0);
    }
  }
}

/**
 * An SDK facade for the instance's network: mainnet's defaults, or a testnet's own PKARR relays
 * (`PUBKY_NETWORK=testnet`). Every facade this adapter makes comes from here.
 */
function createPubky(): Pubky {
  const network = pubkyNetwork();
  return network.network === "testnet"
    ? Pubky.withClient(new Client({ pkarr: { relays: [...network.pkarrRelays] } }))
    : new Pubky();
}

/**
 * Browser-local Pubky adapter. Opaque handles keep SDK keypairs out of application and
 * UI state while this adapter owns all SDK resource cleanup.
 */
export class PubkySdkAdapter {
  private readonly pubky = createPubky();
  private readonly keypairs = new Map<PubkyIdentityKeyHandle, Keypair>();
  private disposed = false;

  static createPubkyRingMigration(
    secretKey: PubkySecretKeyMaterial,
    expectedPublicKeyZ32: string,
  ): PubkyIdentityKeysResult<PubkyRingMigration> {
    if (
      !(secretKey.bytes instanceof Uint8Array) ||
      secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES
    ) {
      clearSecretKey(secretKey, "create_pubky_ring_migration");
      return failure("create_pubky_ring_migration", "input_validation", "invalid_secret_key");
    }

    let keypair: Keypair | undefined;
    try {
      keypair = Keypair.fromSecret(secretKey.bytes);
      const identity = publicIdentity("create_pubky_ring_migration", keypair);
      if (Result.isError(identity) || identity.value.publicKeyZ32 !== expectedPublicKeyZ32) {
        return failure(
          "create_pubky_ring_migration",
          "sdk_public_identity",
          "invalid_secret_key",
          Result.isError(identity) ? identity.error.cause : undefined,
        );
      }
      const migration = new PubkyRingMigration(keypair);
      keypair = undefined;
      return Result.ok(migration);
    } catch (e) {
      return failure("create_pubky_ring_migration", "sdk_export", "export_failed", e);
    } finally {
      clearSecretKey(secretKey, "create_pubky_ring_migration");
      cleanup("create_pubky_ring_migration", "keypair_free", () => keypair?.free());
    }
  }

  createIdentityKey(): PubkyIdentityKeysResult<PubkyIdentityKey> {
    if (this.disposed) {
      return failure("create_identity_key", "adapter_state", "key_unavailable");
    }

    try {
      return this.registerKeypair("create_identity_key", Keypair.random());
    } catch (e) {
      return failure("create_identity_key", "sdk_create", "create_failed", e);
    }
  }

  restoreIdentityKey(secretKey: PubkySecretKeyMaterial): PubkyIdentityKeysResult<PubkyIdentityKey> {
    if (this.disposed) {
      clearSecretKey(secretKey);
      return failure("restore_identity_key", "adapter_state", "key_unavailable");
    }

    if (
      !(secretKey.bytes instanceof Uint8Array) ||
      secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES
    ) {
      clearSecretKey(secretKey);
      return failure("restore_identity_key", "input_validation", "invalid_secret_key");
    }

    try {
      return this.registerKeypair("restore_identity_key", Keypair.fromSecret(secretKey.bytes));
    } catch (e) {
      return failure("restore_identity_key", "sdk_restore", "restore_failed", e);
    } finally {
      clearSecretKey(secretKey);
    }
  }

  /**
   * Decrypts an SDK .pkarr recovery file into an adapter-owned key handle.
   * The supplied byte buffer is always cleared before this method returns.
   */
  restoreRecoveryFile(
    recoveryFile: Uint8Array,
    passphrase: string,
  ): PubkyIdentityKeysResult<PubkyIdentityKey> {
    if (this.disposed) {
      recoveryFile.fill(0);
      return failure("restore_recovery_file", "adapter_state", "key_unavailable");
    }
    if (
      !(recoveryFile instanceof Uint8Array) ||
      recoveryFile.byteLength === 0 ||
      passphrase.length === 0
    ) {
      recoveryFile.fill(0);
      return failure("restore_recovery_file", "input_validation", "restore_failed");
    }

    try {
      return this.registerKeypair(
        "restore_recovery_file",
        Keypair.fromRecoveryFile(recoveryFile, passphrase),
      );
    } catch (e) {
      return failure("restore_recovery_file", "sdk_restore", "restore_failed", e);
    } finally {
      recoveryFile.fill(0);
    }
  }

  createRecoveryFile(
    secretKey: PubkySecretKeyMaterial,
    expectedPublicKeyZ32: string,
    passphrase: string,
  ): PubkyRecoveryFileResult {
    if (this.disposed) {
      clearSecretKey(secretKey, "create_recovery_file");
      return failure("create_recovery_file", "adapter_state", "key_unavailable");
    }
    if (
      !(secretKey.bytes instanceof Uint8Array) ||
      secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES
    ) {
      clearSecretKey(secretKey, "create_recovery_file");
      return failure("create_recovery_file", "input_validation", "invalid_secret_key");
    }
    if (passphrase.length === 0) {
      clearSecretKey(secretKey, "create_recovery_file");
      return failure("create_recovery_file", "input_validation", "invalid_passphrase");
    }

    let keypair: Keypair | undefined;
    try {
      keypair = Keypair.fromSecret(secretKey.bytes);
      const identity = publicIdentity("create_recovery_file", keypair);
      if (Result.isError(identity) || identity.value.publicKeyZ32 !== expectedPublicKeyZ32) {
        return failure(
          "create_recovery_file",
          "sdk_public_identity",
          "invalid_secret_key",
          Result.isError(identity) ? identity.error.cause : undefined,
        );
      }
      return Result.ok(keypair.createRecoveryFile(passphrase));
    } catch (e) {
      return failure("create_recovery_file", "sdk_recovery_file", "recovery_file_failed", e);
    } finally {
      clearSecretKey(secretKey, "create_recovery_file");
      cleanup("create_recovery_file", "keypair_free", () => keypair?.free());
    }
  }

  disposeIdentityKey(keyHandle: PubkyIdentityKeyHandle): void {
    const keypair = this.keypairs.get(keyHandle);
    if (!keypair) return;
    this.keypairs.delete(keyHandle);
    cleanup("dispose_identity_key", "keypair_free", () => keypair.free());
  }

  exportSecretKey(
    keyHandle: PubkyIdentityKeyHandle,
  ): PubkyIdentityKeysResult<PubkySecretKeyMaterial> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return failure("export_secret_key", "key_lookup", "key_unavailable");
    }

    try {
      return Result.ok({
        bytes: keypair.secret(),
        format: PUBKY_SECRET_KEY_FORMAT,
      });
    } catch (e) {
      return failure("export_secret_key", "sdk_export", "export_failed", e);
    }
  }

  async signup(
    keyHandle: PubkyIdentityKeyHandle,
    homeserverPubky: string,
    signupToken?: string | null,
  ): Promise<PubkySessionAccessResult<PubkyAuthenticatedIdentity>> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return failure("signup", "key_lookup", "key_unavailable");
    }

    const homeserver = parsePubkyPublicKey(homeserverPubky, "invalid_homeserver_pubky");
    if (Result.isError(homeserver)) {
      return failure("signup", "homeserver_parse", homeserver.error.code);
    }

    try {
      await this.withSigner("signup", keypair, (signer) =>
        signer.signup(homeserver.value, signupToken ?? null),
      );
      const identity = publicIdentity("signup", keypair);
      if (Result.isError(identity)) {
        return failure("signup", "sdk_public_identity", "signup_failed", identity.error.cause);
      }

      return Result.ok({ publicIdentity: identity.value });
    } catch (e) {
      const status = requestStatus(e);
      return failure(
        "signup",
        "sdk_signup",
        status === 409
          ? "account_exists"
          : isDefinitiveSignupRejection(e, status)
            ? "signup_failed"
            : "signup_uncertain",
        e,
      );
    } finally {
      cleanup("signup", "homeserver_free", () => homeserver.value.free());
    }
  }

  async signin(
    keyHandle: PubkyIdentityKeyHandle,
    mode: "normal" | "after-publication",
  ): Promise<PubkySessionAccessResult<PubkyAuthenticatedIdentity>> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return failure("signin", "key_lookup", "key_unavailable");
    }

    let session: Session | undefined;
    try {
      session = await this.withSigner("signin", keypair, (signer) =>
        mode === "after-publication"
          ? signer.signinBlocking(PASSPORT_CLIENT_ID)
          : signer.signin(PASSPORT_CLIENT_ID),
      );
      try {
        return Result.ok(authenticatedIdentityFromSession("signin", session));
      } finally {
        await session.signout();
      }
    } catch (e) {
      return failure("signin", "sdk_signin", "signin_failed", e);
    } finally {
      cleanup("signin", "session_free", () => session?.free());
    }
  }

  async resolveHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult> {
    const identity = parsePubkyPublicKey(publicKeyZ32, "invalid_pubky");
    if (Result.isError(identity)) return Result.err({ code: "invalid_pubky" });

    let homeserver: PublicKey | undefined;
    try {
      homeserver = await this.pubky.getHomeserverOf(identity.value);
      return Result.ok(homeserver?.z32() ?? null);
    } catch (e) {
      return failure("resolve_homeserver", "sdk_resolution", "resolution_failed", e);
    } finally {
      cleanup("resolve_homeserver", "homeserver_free", () => homeserver?.free());
      cleanup("resolve_homeserver", "public_key_free", () => identity.value.free());
    }
  }

  async approveAuthRequest(
    keyHandle: PubkyIdentityKeyHandle,
    sensitivePubkyAuthUrl: string,
  ): Promise<PubkyAuthApprovalResult> {
    if (!isPubkyAuthRequestUrl(sensitivePubkyAuthUrl)) {
      return failure("approve_auth_request", "request_validation", "request_rejected");
    }

    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return failure("approve_auth_request", "key_lookup", "key_unavailable");
    }

    try {
      await this.withSigner("approve_auth_request", keypair, (signer) =>
        signer.approveAuthRequest(sensitivePubkyAuthUrl),
      );

      return Result.ok();
    } catch (e) {
      return failure("approve_auth_request", "sdk_approval", "approval_failed", e);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const keypairs = [...this.keypairs.values()];
    this.keypairs.clear();
    for (const keypair of keypairs) {
      cleanup("dispose_adapter", "keypair_free", () => keypair.free());
    }
    cleanup("dispose_adapter", "pubky_free", () => this.pubky.free());
  }

  private registerKeypair(
    operation: "create_identity_key" | "restore_identity_key" | "restore_recovery_file",
    keypair: Keypair,
  ): PubkyIdentityKeysResult<PubkyIdentityKey> {
    const identity = publicIdentity(operation, keypair);
    if (Result.isError(identity)) {
      cleanup(operation, "keypair_free", () => keypair.free());
      return failure(operation, "sdk_public_identity", identity.error.code, identity.error.cause);
    }

    const keyHandle = {} as PubkyIdentityKeyHandle;
    this.keypairs.set(keyHandle, keypair);

    return Result.ok(Object.freeze({ keyHandle, publicIdentity: identity.value }));
  }

  /** Force-publishes the signer's `_pubky` record, including when the current record is still fresh. */
  async publishHomeserver(
    keyHandle: PubkyIdentityKeyHandle,
    homeserverPubky?: string | null,
  ): Promise<PubkyPublicationResult> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return failure("publish_homeserver", "key_lookup", "key_unavailable");
    }

    const homeserver = parseOptionalHomeserverPublicKey(homeserverPubky);
    if (Result.isError(homeserver)) {
      return failure("publish_homeserver", "homeserver_parse", homeserver.error.code);
    }

    let transferredToSdk = false;
    try {
      await this.withSigner("publish_homeserver", keypair, async (signer) => {
        const pkdns = signer.pkdns;
        try {
          transferredToSdk = homeserver.value !== null;
          await pkdns.publishHomeserverForce(homeserver.value);
        } finally {
          cleanup("publish_homeserver", "pkdns_free", () => pkdns.free());
        }
      });

      return Result.ok();
    } catch (e) {
      return failure("publish_homeserver", "sdk_publish", "publish_failed", e);
    } finally {
      if (!transferredToSdk) {
        cleanup("publish_homeserver", "homeserver_free", () => homeserver.value?.free());
      }
    }
  }

  private keypairFor(keyHandle: PubkyIdentityKeyHandle): Keypair | undefined {
    return this.disposed ? undefined : this.keypairs.get(keyHandle);
  }

  private async withSigner<OperationResult>(
    operationName: PubkyOperation,
    keypair: Keypair,
    operation: (signer: Signer) => Promise<OperationResult>,
  ): Promise<OperationResult> {
    const signer = this.pubky.signer(keypair);
    try {
      return await operation(signer);
    } finally {
      cleanup(operationName, "signer_free", () => signer.free());
    }
  }
}

/**
 * Resolves one identity without retaining an SDK adapter.
 * SDK initialization and resolution failures settle as a Result; the promise does not
 * intentionally reject.
 */
export async function resolvePubkyHomeserver(
  publicKeyZ32: string,
): Promise<PubkyHomeserverResolutionResult> {
  let pubky: PubkySdkAdapter;
  try {
    pubky = new PubkySdkAdapter();
  } catch (e) {
    return failure("resolve_homeserver", "sdk_initialize", "resolution_failed", e);
  }

  try {
    return await pubky.resolveHomeserver(publicKeyZ32);
  } catch (e) {
    return failure("resolve_homeserver", "sdk_resolution", "resolution_failed", e);
  } finally {
    pubky.dispose();
  }
}

function publicIdentity(
  operation: PubkyOperation,
  keypair: Keypair,
): PubkyIdentityKeysResult<PubkyPublicIdentity> {
  try {
    const publicKey = keypair.publicKey;
    try {
      return Result.ok(
        Object.freeze({
          publicKeyZ32: publicKey.z32(),
        }),
      );
    } finally {
      cleanup(operation, "public_key_free", () => publicKey.free());
    }
  } catch (e) {
    return Result.err({ code: "public_identity_failed", cause: e });
  }
}

function parsePubkyPublicKey<ErrorCode extends string>(
  value: string,
  errorCode: ErrorCode,
): PublicKeyParseResult<ErrorCode> {
  if (value.trim().length === 0) {
    return Result.err({ code: errorCode });
  }

  try {
    return Result.ok(PublicKey.from(value));
  } catch {
    return Result.err({ code: errorCode });
  }
}

function parseOptionalHomeserverPublicKey(
  value: string | null | undefined,
): ResultType<PublicKey | null, CodedFailure<"invalid_homeserver_pubky">> {
  return value === null || value === undefined
    ? Result.ok(null)
    : parsePubkyPublicKey(value, "invalid_homeserver_pubky");
}

function isPubkyAuthRequestUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "pubkyauth:";
  } catch {
    return false;
  }
}

function authenticatedIdentityFromSession(
  operation: "signup" | "signin",
  session: Session,
): PubkyAuthenticatedIdentity {
  const info = session.info;
  try {
    const publicKey = info.publicKey;
    try {
      return Object.freeze({
        publicIdentity: Object.freeze({
          publicKeyZ32: publicKey.z32(),
        }),
      });
    } finally {
      cleanup(operation, "session_public_key_free", () => publicKey.free());
    }
  } finally {
    cleanup(operation, "session_info_free", () => info.free());
  }
}

type PubkyOperation =
  | "approve_auth_request"
  | "create_identity_key"
  | "create_pubky_ring_migration"
  | "create_recovery_file"
  | "dispose_adapter"
  | "dispose_identity_key"
  | "disconnect_ring_profile_grant"
  | "dispose_ring_profile_grant"
  | "export_secret_key"
  | "poll_ring_profile_grant"
  | "publish_homeserver"
  | "publish_ring_profile"
  | "read_profile_resource"
  | "resolve_homeserver"
  | "restore_identity_key"
  | "restore_recovery_file"
  | "resume_ring_profile_grant"
  | "save_ring_profile_grant"
  | "signin"
  | "signup"
  | "start_ring_profile_grant"
  | "start_ring_verification"
  | "write_profile";

type PubkyFailureStage =
  | "adapter_state"
  | "grant_capabilities"
  | "grant_state"
  | "homeserver_parse"
  | "identity_check"
  | "image_type"
  | "input_validation"
  | "key_lookup"
  | "request_validation"
  | "response_body"
  | "response_parse"
  | "response_status"
  | "response_timeout"
  | "sdk_approval"
  | "sdk_create"
  | "sdk_export"
  | "sdk_grant_poll"
  | "sdk_grant_start"
  | "sdk_initialize"
  | "sdk_public_identity"
  | "sdk_read"
  | "sdk_recovery_file"
  | "sdk_publish"
  | "sdk_resolution"
  | "sdk_restore"
  | "sdk_session_store"
  | "sdk_signin"
  | "sdk_signup"
  | "sdk_write";

type PubkyCleanupStage =
  | "delegated_keys_clear"
  | "flow_free"
  | "homeserver_free"
  | "keypair_free"
  | "pkdns_free"
  | "pubky_free"
  | "public_key_free"
  | "secret_key_clear"
  | "session_free"
  | "session_info_free"
  | "session_public_key_free"
  | "session_signout"
  | "session_store_free"
  | "session_store_remove"
  | "signer_free"
  | "storage_free";

type PubkyErrorCode =
  | PubkyAuthApprovalErrorCode
  | PubkyPublicationErrorCode
  | PubkyIdentityKeysErrorCode
  | PubkyProfileGrantErrorCode
  | PubkyProfileReadErrorCode
  | PubkyProfileWriteErrorCode
  | PubkyRecoveryFileErrorCode
  | PubkySessionAccessErrorCode
  | "invalid_pubky"
  | "resolution_failed";

function failure<Success, Code extends PubkyErrorCode>(
  operation: PubkyOperation,
  stage: PubkyFailureStage,
  code: Code,
  cause?: unknown,
): ResultType<Success, CodedFailure<Code>> {
  if (cause === undefined) {
    LOGGER.warn("identity.pubky.operation.failed", { operation, stage, code });
    return Result.err({ code });
  }
  const sdkErrorName = safePubkySdkErrorName(cause);
  LOGGER.warn("identity.pubky.operation.failed", {
    operation,
    stage,
    ...(sdkErrorName ? { sdkErrorName } : {}),
    ...safeErrorLogFields(cause),
    code,
  });
  return Result.err({ code, cause });
}

function safePubkySdkErrorName(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
    const name = (error as { name?: unknown }).name;
    switch (name) {
      case "AuthenticationError":
      case "ClientStateError":
      case "InternalError":
      case "InvalidInput":
      case "PkarrError":
      case "RequestError":
        return name;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function requestStatus(error: unknown): number | undefined {
  try {
    if (
      typeof error !== "object" ||
      error === null ||
      (error as Partial<PubkyError>).name !== "RequestError"
    ) {
      return undefined;
    }
    const data = (error as Partial<PubkyError>).data;
    if (typeof data !== "object" || data === null || !("statusCode" in data)) return undefined;
    const statusCode = (data as { statusCode?: unknown }).statusCode;
    return typeof statusCode === "number" && Number.isInteger(statusCode) ? statusCode : undefined;
  } catch {
    return undefined;
  }
}

function isDefinitiveSignupRejection(error: unknown, status: number | undefined): boolean {
  const errorName = safePubkySdkErrorName(error);
  return (
    errorName === "AuthenticationError" ||
    errorName === "ClientStateError" ||
    errorName === "InvalidInput" ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422
  );
}

function cleanup(operation: PubkyOperation, stage: PubkyCleanupStage, action: () => void): void {
  try {
    action();
  } catch (e) {
    logCleanupFailure(operation, stage, e);
  }
}

function logCleanupFailure(operation: PubkyOperation, stage: PubkyCleanupStage, e: unknown): void {
  LOGGER.warn("identity.pubky.cleanup.failed", {
    operation,
    stage,
    code: "cleanup_failed",
    ...safeErrorLogFields(e),
  });
}

function clearSecretKey(
  secretKey: PubkySecretKeyMaterial,
  operation:
    | "create_pubky_ring_migration"
    | "create_recovery_file"
    | "restore_identity_key" = "restore_identity_key",
): void {
  cleanup(operation, "secret_key_clear", () => secretKey.bytes.fill(0));
}

/**
 * One unauthenticated client serves public profile reads and signup-token checks for the page's
 * lifetime, keeping its resolver cache and connections warm. It holds no session or key material,
 * so it is a deliberate exception to freeing SDK handles and is released with the page. The client
 * getter allocates a new handle on every access, so it is read once here.
 */
let sharedPublicReader: { pubky: Pubky; client: Client; storage: PublicStorage } | undefined;

function sharedPublicClient(): { pubky: Pubky; client: Client; storage: PublicStorage } {
  if (!sharedPublicReader) {
    const pubky = createPubky();
    sharedPublicReader = { pubky, client: pubky.client, storage: pubky.publicStorage };
  }
  return sharedPublicReader;
}

/**
 * Unauthenticated request to a homeserver addressed by its public key. The SDK resolves the key
 * through PKARR, so the request reaches the same host that signup would.
 */
export function fetchHomeserver(url: string, init: RequestInit): Promise<Response> {
  return sharedPublicClient().client.fetch(url, init);
}

const MAX_PROFILE_DOCUMENT_BYTES = 64 * 1024;

type PubkyProfileReadErrorCode =
  "invalid_resource" | "read_failed" | "read_timeout" | "resource_too_large";
export type PubkyProfileReadResult<Success> = ResultType<
  Success,
  CodedFailure<PubkyProfileReadErrorCode>
>;
type PubkyProfileWriteErrorCode =
  | "grant_unavailable"
  | "identity_mismatch"
  | "publish_failed"
  | "publish_unauthorized"
  | "signin_failed";
export type PubkyProfileWriteResult = ResultType<void, CodedFailure<PubkyProfileWriteErrorCode>>;
/**
 * `homeserver_unresolved` and `grant_rejected` happen after Ring approved: the approving pubky's
 * homeserver could not be looked up, or it refused the grant (an authentication error, 401 or 403).
 * `grant_failed` covers the rest, including transport failures and statuses such as 404, which
 * may come from the relay before approval as well as from the homeserver after it.
 */
export type PubkyProfileGrantErrorCode =
  | "grant_busy"
  | "grant_failed"
  | "grant_rejected"
  | "homeserver_unresolved"
  | "missing_capabilities";
export type PubkyProfileGrantResult<Success> = ResultType<
  Success,
  CodedFailure<PubkyProfileGrantErrorCode>
>;

export class PubkyProfileTransport {
  /** Reads a public JSON document; `null` when it does not exist. */
  async readJson(address: string): Promise<PubkyProfileReadResult<unknown>> {
    const read = await readPublicResource(address, MAX_PROFILE_DOCUMENT_BYTES);
    if (Result.isError(read) || read.value === null) return read;
    try {
      return Result.ok(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.value)));
    } catch (e) {
      return failure("read_profile_resource", "response_parse", "invalid_resource", e);
    }
  }

  /** Reads a public image; the type comes from its signature, never from the served header. */
  async readImage(address: string): Promise<PubkyProfileReadResult<Blob>> {
    const read = await readPublicResource(address, MAX_AVATAR_BYTES);
    if (Result.isError(read)) return read;
    if (read.value === null)
      return failure("read_profile_resource", "response_status", "read_failed");
    const type = sniffImageType(read.value);
    if (!type || !AVATAR_TYPES.includes(type)) {
      return failure("read_profile_resource", "image_type", "invalid_resource");
    }
    return Result.ok(new Blob([read.value], { type }));
  }

  /**
   * Applies a prepared publication with a session that exists only for this call.
   *
   * `signin` grants root `/:rw`. A scoped session would need Passport to approve its own grant
   * (`startGrantAuthFlow` plus `Signer.approveAuthRequest`) through the HTTP relay, which adds a
   * network party. The secret key is already in this context, so a narrower grant would not narrow
   * what this code can do. Every input is validated before sign-in, and the root session exists
   * only for this call and is revoked on every path.
   */
  async writeProfile(
    publicKey: string,
    secret: Uint8Array,
    writes: readonly ProfileWrite[],
  ): Promise<PubkyProfileWriteResult> {
    let pubky: Pubky | undefined;
    let keypair: Keypair | undefined;
    let signer: Signer | undefined;
    let session: Session | undefined;
    try {
      pubky = createPubky();
      keypair = Keypair.fromSecret(secret);
      const identity = publicIdentity("write_profile", keypair);
      if (Result.isError(identity) || identity.value.publicKeyZ32 !== publicKey) {
        return failure(
          "write_profile",
          "identity_check",
          "identity_mismatch",
          Result.isError(identity) ? identity.error.cause : undefined,
        );
      }
      signer = pubky.signer(keypair);
      try {
        session = await signer.signin(PASSPORT_CLIENT_ID);
      } catch (e) {
        return failure("write_profile", "sdk_signin", "signin_failed", e);
      }
      return await applyProfileWrites("write_profile", session, writes);
    } catch (e) {
      return failure("write_profile", "sdk_initialize", "publish_failed", e);
    } finally {
      await revokeSession("write_profile", session);
      cleanup("write_profile", "signer_free", () => signer?.free());
      cleanup("write_profile", "keypair_free", () => keypair?.free());
      cleanup("write_profile", "pubky_free", () => pubky?.free());
    }
  }
}

/**
 * Passport's own client ID for its grants: its origin's host, so a grant names the instance that
 * holds it (and Ring lists it under that name).
 */
function passportClientId(): string {
  return globalThis.location?.host ?? PASSPORT_CLIENT_ID;
}

/** A stored profile grant is reused only while at least this long remains of it. */
const STORED_GRANT_MARGIN_SECONDS = 60;

/**
 * Starts a delegated profile grant without obtaining the identity's private key, and keeps an
 * approved one for its identity: the SDK's browser session store holds it (its PoP key
 * non-extractable in IndexedDB, bound to this origin) until it expires or is revoked, so the next
 * profile edit for that key reconnects without asking the keychain again.
 */
export class PubkyRingProfileTransport {
  /**
   * `relay` is the instance's configured HTTP relay for Passport's own grant requests; `method`
   * `cookie` asks the legacy way, for Pubky Ring older than 2.0.
   */
  start(
    relay: string,
    method: KeychainAuthMethod = "grant",
  ): Promise<PubkyProfileGrantResult<RingProfileGrant>> {
    return startRingGrant(
      "start_ring_profile_grant",
      relay,
      PROFILE_CAPABILITIES,
      { xSource: "Pubky Passport profile" },
      method,
      // Only a grant can be stored; the legacy cookie sign-in lasts for the page.
      method === "grant",
    );
  }

  /**
   * The stored profile grant of `publicKey`, connected again without asking the keychain; `undefined`
   * when none is stored, it is about to expire, or the homeserver no longer accepts it (revoked in
   * the keychain's Authorized Apps, say), in which case its record is removed.
   */
  async resume(publicKey: string): Promise<PubkyProfileGrantResult<RingProfileGrant | undefined>> {
    let pubky: Pubky | undefined;
    let store: BrowserSessionStore | undefined;
    let release: DelegatedKeyRelease | undefined;
    let session: Session | undefined;
    try {
      pubky = createPubky();
      release = await holdDelegatedKeys();
      store = pubky.browserSessionStore;
      const id = await storedProfileGrantId(store, publicKey);
      if (!id) return Result.ok(undefined);
      try {
        session = await store.restore(id);
      } catch (e) {
        // Revoked or no longer valid: forget it, and connect anew.
        logCleanupFailure("resume_ring_profile_grant", "session_store_remove", e);
        await removeStored("resume_ring_profile_grant", store, id);
        return Result.ok(undefined);
      }
      const info = session.info;
      try {
        const key = info.publicKey;
        let restoredKey: string;
        try {
          restoredKey = key.z32();
        } finally {
          cleanup("resume_ring_profile_grant", "session_public_key_free", () => key.free());
        }
        if (restoredKey !== publicKey || !isProfileGrant(info.capabilities)) {
          await removeStored("resume_ring_profile_grant", store, id);
          return Result.ok(undefined);
        }
      } finally {
        cleanup("resume_ring_profile_grant", "session_info_free", () => info.free());
      }
      const grant = RingProfileGrant.restored(pubky, session, publicKey, id, release);
      session = undefined;
      pubky = undefined;
      release = undefined;
      return Result.ok(grant);
    } catch (e) {
      return failure("resume_ring_profile_grant", "sdk_session_store", "grant_failed", e);
    } finally {
      if (session) cleanup("resume_ring_profile_grant", "session_free", () => session?.free());
      cleanup("resume_ring_profile_grant", "session_store_free", () => store?.free());
      await release?.();
      cleanup("resume_ring_profile_grant", "pubky_free", () => pubky?.free());
    }
  }

  /** Whether a profile grant for `publicKey` is stored in this browser (Manage's Disconnect). */
  async stored(publicKey: string): Promise<boolean> {
    let pubky: Pubky | undefined;
    let store: BrowserSessionStore | undefined;
    try {
      pubky = createPubky();
      store = pubky.browserSessionStore;
      return (await storedProfileGrantId(store, publicKey)) !== undefined;
    } catch (e) {
      logCleanupFailure("resume_ring_profile_grant", "session_store_free", e);
      return false;
    } finally {
      cleanup("resume_ring_profile_grant", "session_store_free", () => store?.free());
      cleanup("resume_ring_profile_grant", "pubky_free", () => pubky?.free());
    }
  }

  /**
   * Revokes the stored profile grant of `publicKey` (the session signs out, which deletes the grant
   * on the homeserver) and forgets it. A grant the homeserver no longer accepts is only forgotten.
   */
  async disconnect(publicKey: string): Promise<PubkyProfileGrantResult<void>> {
    let pubky: Pubky | undefined;
    let store: BrowserSessionStore | undefined;
    let release: DelegatedKeyRelease | undefined;
    try {
      pubky = createPubky();
      release = await holdDelegatedKeys();
      store = pubky.browserSessionStore;
      const tried = new Set<string>();
      for (;;) {
        const id = await storedProfileGrantId(store, publicKey, 0);
        if (!id) return Result.ok();
        // A record that could not be removed is not tried twice: the disconnect did not finish.
        if (tried.has(id))
          return failure("disconnect_ring_profile_grant", "sdk_session_store", "grant_failed");
        tried.add(id);
        let session: Session | undefined;
        try {
          session = await store.restore(id);
        } catch (e) {
          logCleanupFailure("disconnect_ring_profile_grant", "session_signout", e);
        }
        await revokeSession("disconnect_ring_profile_grant", session);
        if (!(await removeStored("disconnect_ring_profile_grant", store, id)))
          return failure("disconnect_ring_profile_grant", "sdk_session_store", "grant_failed");
      }
    } catch (e) {
      return failure("disconnect_ring_profile_grant", "sdk_session_store", "grant_failed", e);
    } finally {
      cleanup("disconnect_ring_profile_grant", "session_store_free", () => store?.free());
      await release?.();
      cleanup("disconnect_ring_profile_grant", "pubky_free", () => pubky?.free());
    }
  }
}

/**
 * The stored record of Passport's profile grant for `publicKey`: this origin's client ID, exactly
 * the write-only profile capabilities, and more than `marginSeconds` left before it expires.
 */
async function storedProfileGrantId(
  store: BrowserSessionStore,
  publicKey: string,
  marginSeconds = STORED_GRANT_MARGIN_SECONDS,
): Promise<string | undefined> {
  if (!(await store.isAvailable())) return undefined;
  await removeExpired(store, "resume_ring_profile_grant");
  const records = await store.list();
  let found: string | undefined;
  const clientId = passportClientId();
  const now = Date.now() / 1000;
  for (const record of records) {
    try {
      if (
        found === undefined &&
        record.publicKey === publicKey &&
        record.clientId === clientId &&
        isProfileGrant(record.capabilities) &&
        record.grantExpiresAt > now + marginSeconds
      )
        found = record.id;
    } finally {
      cleanup("resume_ring_profile_grant", "session_store_free", () => record.free());
    }
  }
  return found;
}

/** Exactly Passport's write-only profile grant: nothing to read, nothing beyond the profile. */
function isProfileGrant(capabilities: readonly string[]): boolean {
  return (
    grantsCapabilities(capabilities, PROFILE_CAPABILITIES) &&
    capabilities.every((capability) => grantsCapabilities(PROFILE_CAPABILITIES, [capability]))
  );
}

/** Removes one stored record; `false` when the store refused. */
async function removeStored(
  operation: PubkyOperation,
  store: BrowserSessionStore,
  id: string,
): Promise<boolean> {
  try {
    await store.remove(id);
    return true;
  } catch (e) {
    logCleanupFailure(operation, "session_store_remove", e);
    return false;
  }
}

/**
 * Removes the records of grants that have expired: useless, and they would keep the delegated keys
 * of abandoned flows from ever being cleared.
 */
async function removeExpired(store: BrowserSessionStore, operation: PubkyOperation): Promise<void> {
  const records = await store.list();
  const expired: string[] = [];
  const now = Date.now() / 1000;
  for (const record of records) {
    try {
      if (record.grantExpiresAt <= now) expired.push(record.id);
    } finally {
      cleanup(operation, "session_store_free", () => record.free());
    }
  }
  for (const id of expired) await removeStored(operation, store, id);
}

/**
 * Asks Pubky Ring to approve a sign-in that grants nothing, to prove it holds a key saved in this
 * browser: the approval names the key Ring signed it with, and its Session is signed out as soon
 * as that key is read (see {@link RingProfileGrant.dispose}). Ring's and a homeserver's handling of
 * a request without capabilities is not device-tested yet.
 */
export class PubkyRingVerificationTransport {
  /**
   * `relay` is the instance's configured HTTP relay for Passport's own grant requests; `method`
   * `cookie` asks the legacy way, for Pubky Ring older than 2.0.
   */
  start(
    relay: string,
    method: KeychainAuthMethod = "grant",
  ): Promise<PubkyProfileGrantResult<RingProfileGrant>> {
    return startRingGrant(
      "start_ring_verification",
      relay,
      [],
      { xSource: "Pubky Passport backup check" },
      method,
    );
  }
}

/**
 * Starts one of Passport's own requests for Pubky Ring: a grant (`grant`, the default), or the
 * legacy cookie sign-in (`cookie`) that Pubky Ring older than 2.0 needs. Both yield a `Session`
 * that the same {@link RingProfileGrant} checks, uses and signs out; a cookie flow holds no
 * delegated key.
 */
async function startRingGrant(
  operation: PubkyOperation,
  relay: string,
  capabilities: readonly string[],
  xCallback: { xSource: string },
  method: KeychainAuthMethod = "grant",
  persist = false,
): Promise<PubkyProfileGrantResult<RingProfileGrant>> {
  let pubky: Pubky | undefined;
  let release: DelegatedKeyRelease | undefined;
  try {
    pubky = createPubky();
    if (method === "cookie") {
      // The SDK takes ownership of AuthFlowKind, so the caller must not free it afterward.
      const flow = pubky.startCookieAuthFlow(
        capabilities.join(",") as Capabilities,
        AuthFlowKind.signin(),
        relay,
        xCallback,
      );
      return Result.ok(new RingProfileGrant(pubky, flow, undefined, capabilities));
    }
    // Keys of flows whose page closed before their cleanup finished.
    await clearUnusedDelegatedKeys(pubky);
    release = await holdDelegatedKeys();
    // The SDK takes ownership of AuthFlowKind, so the caller must not free it afterward.
    const flow = await pubky.startGrantAuthFlow(
      capabilities.join(",") as Capabilities,
      AuthFlowKind.signin(),
      { clientId: passportClientId(), relay, xCallback },
    );
    return Result.ok(new RingProfileGrant(pubky, flow, release, capabilities, persist));
  } catch (e) {
    await release?.();
    cleanup(operation, "pubky_free", () => pubky?.free());
    return failure(operation, "sdk_grant_start", "grant_failed", e);
  }
}

/**
 * Owns one pending Ring request and the grant it yields: Passport's profile grant, or the
 * verification of a key that asks for no capabilities. A profile grant (`persist`) is stored once
 * approved and outlives the page; a verification, and the legacy cookie sign-in, last for the page.
 */
export class RingProfileGrant {
  private session: Session | undefined;
  private publicKey: string | undefined;
  /** The browser session store's record of this grant, once stored. */
  private storedId: string | undefined;
  private disposed = false;
  private busy = false;
  private cleaned = false;

  /**
   * `release` frees this grant's hold on the browser's delegated keys; `required` lists what the
   * approval must grant; `persist` stores the approved grant for its identity.
   */
  constructor(
    private readonly pubky: Pubky,
    /** A grant flow, the legacy cookie flow for Pubky Ring older than 2.0, or none when restored. */
    private readonly flow: GrantAuthFlow | AuthFlow | undefined,
    private readonly release: DelegatedKeyRelease = async () => undefined,
    private readonly required: readonly string[] = PROFILE_CAPABILITIES,
    private readonly persist = false,
  ) {}

  /** A profile grant restored from the browser session store: connected, nothing to approve. */
  static restored(
    pubky: Pubky,
    session: Session,
    publicKey: string,
    storedId: string,
    release: DelegatedKeyRelease,
  ): RingProfileGrant {
    const grant = new RingProfileGrant(pubky, undefined, release, PROFILE_CAPABILITIES, true);
    grant.session = session;
    grant.publicKey = publicKey;
    grant.storedId = storedId;
    return grant;
  }

  authorizationUrl(): string | undefined {
    return this.disposed || this.session ? undefined : this.flow?.authorizationUrl;
  }

  /** Resolves the approving identity once Ring has granted every required capability. */
  async poll(): Promise<PubkyProfileGrantResult<string | undefined>> {
    if (this.disposed) return Result.ok(undefined);
    if (this.publicKey) return Result.ok(this.publicKey);
    if (this.busy) return failure("poll_ring_profile_grant", "grant_state", "grant_busy");
    if (!this.flow) return failure("poll_ring_profile_grant", "grant_state", "grant_failed");
    this.busy = true;
    try {
      this.session = await this.flow.tryPollOnce();
      if (!this.session || this.disposed) return Result.ok(undefined);
      const info = this.session.info;
      try {
        if (!grantsCapabilities(info.capabilities, this.required)) {
          return failure("poll_ring_profile_grant", "grant_capabilities", "missing_capabilities");
        }
        const key = info.publicKey;
        try {
          this.publicKey = key.z32();
        } finally {
          cleanup("poll_ring_profile_grant", "session_public_key_free", () => key.free());
        }
        return Result.ok(this.publicKey);
      } finally {
        cleanup("poll_ring_profile_grant", "session_info_free", () => info.free());
      }
    } catch (e) {
      return failure("poll_ring_profile_grant", "sdk_grant_poll", grantPollFailure(e), e);
    } finally {
      this.busy = false;
      await this.cleanup();
    }
  }

  async publish(
    expectedKey: string,
    writes: readonly ProfileWrite[],
  ): Promise<PubkyProfileWriteResult> {
    // A verification's grant asked for nothing, so it never writes either.
    if (
      this.disposed ||
      !this.session ||
      this.publicKey !== expectedKey ||
      this.busy ||
      this.required.length === 0
    ) {
      return failure("publish_ring_profile", "grant_state", "grant_unavailable");
    }
    this.busy = true;
    try {
      const written = await applyProfileWrites("publish_ring_profile", this.session, writes);
      // Refused: the grant was revoked (in the keychain's Authorized Apps, say), so forget it.
      if (
        Result.isError(written) &&
        written.error.code === "publish_unauthorized" &&
        this.storedId
      ) {
        await this.forget("publish_ring_profile");
      }
      return written;
    } finally {
      this.busy = false;
      await this.cleanup();
    }
  }

  /**
   * Stores the approved profile grant for its identity, once Passport accepted that identity (the
   * expected key, or a Ring signup's confirmed one). Only exactly the write-only profile grant is
   * kept; a wider approval lasts for the page and is revoked when the connection closes. A failure
   * only logs: the grant then lasts for the page, as before.
   */
  async keep(): Promise<void> {
    if (!this.persist || this.storedId || this.disposed || this.busy || !this.session) return;
    const info = this.session.info;
    let exact: boolean;
    try {
      exact = isProfileGrant(info.capabilities);
    } finally {
      cleanup("save_ring_profile_grant", "session_info_free", () => info.free());
    }
    if (!exact) return;
    this.busy = true;
    try {
      await this.store();
    } finally {
      this.busy = false;
      await this.cleanup();
    }
  }

  private async store(): Promise<void> {
    if (!this.session) return;
    let store: BrowserSessionStore | undefined;
    try {
      store = this.pubky.browserSessionStore;
      if (!(await store.isAvailable())) return;
      const saved = await store.save(this.session);
      try {
        this.storedId = saved.id;
      } finally {
        cleanup("save_ring_profile_grant", "session_store_free", () => saved.free());
      }
    } catch (e) {
      logCleanupFailure("save_ring_profile_grant", "session_store_free", e);
    } finally {
      cleanup("save_ring_profile_grant", "session_store_free", () => store?.free());
    }
  }

  private async forget(operation: PubkyOperation): Promise<void> {
    const id = this.storedId;
    if (!id) return;
    this.storedId = undefined;
    let store: BrowserSessionStore | undefined;
    try {
      store = this.pubky.browserSessionStore;
      await removeStored(operation, store, id);
    } finally {
      cleanup(operation, "session_store_free", () => store?.free());
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.cleanup();
  }

  /**
   * Once disposed, after any SDK call in progress has settled: a stored profile grant is only freed
   * (it stays valid for its identity's next edit); any other session is revoked. Then the browser's
   * delegated keys are deleted unless another grant still signs with one or a grant is stored.
   */
  private async cleanup(): Promise<void> {
    if (!this.disposed || this.busy || this.cleaned) return;
    this.cleaned = true;
    if (this.storedId)
      cleanup("dispose_ring_profile_grant", "session_free", () => this.session?.free());
    else await revokeSession("dispose_ring_profile_grant", this.session);
    cleanup("dispose_ring_profile_grant", "flow_free", () => this.flow?.free());
    await this.release();
    await clearUnusedDelegatedKeys(this.pubky);
    cleanup("dispose_ring_profile_grant", "pubky_free", () => this.pubky.free());
  }
}

/**
 * Names the step a profile grant poll failed at, as far as the SDK error shows it. PKARR failures
 * and an unresolvable homeserver come after Ring approved. Only errors the relay cannot produce
 * count as the homeserver refusing the grant: an authentication error, or a 401 or 403 status (the
 * relay authenticates nothing). Other client error statuses may come from the relay before any
 * approval (a 404 "Entry expired", a 400 for an over-long ID, a 413 for an over-large body, or a
 * proxy in front of it), so they stay `grant_failed` with transport failures and server errors.
 */
function grantPollFailure(error: unknown): PubkyProfileGrantErrorCode {
  const name = safePubkySdkErrorName(error);
  if (name === "PkarrError") return "homeserver_unresolved";
  if (name === "AuthenticationError") return "grant_rejected";
  const status = requestStatus(error);
  if (status === 401 || status === 403) return "grant_rejected";
  // SDK 0.11 reports a pubky without a homeserver record as a RequestError without a status.
  if (
    name === "RequestError" &&
    status === undefined &&
    /resolve homeserver/iu.test(errorMessage(error))
  )
    return "homeserver_unresolved";
  return "grant_failed";
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : "";
  } catch {
    return "";
  }
}

/**
 * Deletes the SDK's browser-held delegated PoP keys, including those of abandoned flows, unless a
 * grant in any Passport tab may still sign with one, or a profile grant is stored: the store keeps
 * its key with the others, and clearing them would break it. Deleting a key revokes nothing.
 */
async function clearUnusedDelegatedKeys(pubky: Pubky): Promise<void> {
  let store: BrowserSessionStore | undefined;
  try {
    // Without delegation support every flow holds its PoP key in memory; nothing is stored.
    if (!GrantAuthFlow.isDelegationAvailable) return;
    await whenDelegatedKeysUnused(async () => {
      store = pubky.browserSessionStore;
      await removeExpired(store, "dispose_ring_profile_grant");
      const records = await store.list();
      const anyStored = records.length > 0;
      for (const record of records)
        cleanup("dispose_ring_profile_grant", "session_store_free", () => record.free());
      if (!anyStored) await store.clearAll();
    });
  } catch (e) {
    logCleanupFailure("dispose_ring_profile_grant", "delegated_keys_clear", e);
  } finally {
    cleanup("dispose_ring_profile_grant", "session_store_free", () => store?.free());
  }
}

/** Writes in order, so `profile.json` is written only after its avatar blob and file record. */
async function applyProfileWrites(
  operation: "publish_ring_profile" | "write_profile",
  session: Session,
  writes: readonly ProfileWrite[],
): Promise<PubkyProfileWriteResult> {
  let storage: SessionStorage | undefined;
  try {
    storage = session.storage;
    for (const write of writes) {
      if (write.kind === "bytes") await storage.putBytes(write.path as Path, write.bytes);
      else await storage.putJson(write.path as Path, write.json);
    }
    return Result.ok();
  } catch (e) {
    const status = requestStatus(e);
    return failure(
      operation,
      "sdk_write",
      status === 401 || status === 403 ? "publish_unauthorized" : "publish_failed",
      e,
    );
  } finally {
    cleanup(operation, "storage_free", () => storage?.free());
  }
}

/** Signs out (revoking the grant) and frees the session; a failed revoke is logged, not thrown. */
async function revokeSession(
  operation: PubkyOperation,
  session: Session | undefined,
): Promise<void> {
  if (!session) return;
  try {
    await session.signout();
  } catch (e) {
    logCleanupFailure(operation, "session_signout", e);
  }
  cleanup(operation, "session_free", () => session.free());
}

const READ_DEADLINE = Symbol("read deadline");

/**
 * Reads a public resource within {@link REQUEST_TIMEOUT_MS} and `limit` bytes; `null` when it does
 * not exist. The SDK read takes no abort signal, so a late response is cancelled when it arrives.
 */
async function readPublicResource(
  address: string,
  limit: number,
): Promise<PubkyProfileReadResult<Uint8Array<ArrayBuffer> | null>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(READ_DEADLINE), REQUEST_TIMEOUT_MS);
  });
  deadline.catch(() => undefined);
  const beforeDeadline = <T>(pending: Promise<T>) => Promise.race([pending, deadline]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const request = sharedPublicClient().storage.get(address as Address);
    request.catch(() => undefined);
    let response: Response;
    try {
      response = await beforeDeadline(request);
    } catch (e) {
      if (e === READ_DEADLINE) {
        void request.then((late) => late.body?.cancel()).catch(() => undefined);
        throw e;
      }
      if (requestStatus(e) === 404) return Result.ok(null);
      return failure("read_profile_resource", "sdk_read", "read_failed", e);
    }
    reader = response.body?.getReader();
    if (response.status === 404) return Result.ok(null);
    if (!response.ok) return failure("read_profile_resource", "response_status", "read_failed");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (reader) {
      const { done, value } = await beforeDeadline(reader.read());
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        return failure("read_profile_resource", "response_body", "resource_too_large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return Result.ok(bytes);
  } catch (e) {
    if (e === READ_DEADLINE) {
      return failure("read_profile_resource", "response_timeout", "read_timeout");
    }
    return failure("read_profile_resource", "response_body", "read_failed", e);
  } finally {
    clearTimeout(timer);
    void reader?.cancel().catch(() => undefined);
  }
}
