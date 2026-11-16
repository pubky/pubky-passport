import "client-only";

import {
  GrantManager,
  Keypair,
  Pubky,
  PublicKey,
  type GrantInfo,
  type PubkyError,
  type Session,
} from "@synonymdev/pubky";
import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import { hasRecoveryFileShape } from "@/client/logic/identity-import/recoveryFile";
import { browserPassportSessionLedger, type PassportSessionLedger } from "./passportSessionLedger";
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
type PubkyRecoveryFileImportErrorCode =
  "invalid_recovery_file" | "key_unavailable" | "recovery_file_undecryptable";
export type PubkyRecoveryFileImportResult = ResultType<
  PubkyIdentityKey,
  CodedFailure<PubkyRecoveryFileImportErrorCode>
>;
type PubkyAuthApprovalErrorCode =
  "approval_failed" | "expected_signer_mismatch" | "key_unavailable" | "request_rejected";
export type PubkyAuthApprovalResult = ResultType<void, CodedFailure<PubkyAuthApprovalErrorCode>>;

/** An app the user authorized, as listed by the homeserver. Times are Unix seconds. */
export type PubkyAuthorizedApp = Readonly<{
  grantId: string;
  clientId: string;
  capabilities: readonly string[];
  issuedAt: number;
  expiresAt: number;
}>;
type PubkyAuthorizedAppsErrorCode = "key_unavailable" | "list_failed";
export type PubkyAuthorizedAppsResult = ResultType<
  readonly PubkyAuthorizedApp[],
  CodedFailure<PubkyAuthorizedAppsErrorCode>
>;
type PubkyAuthorizedAppRevocationErrorCode =
  "invalid_grant_id" | "key_unavailable" | "revoke_failed";
export type PubkyAuthorizedAppRevocationResult = ResultType<
  void,
  CodedFailure<PubkyAuthorizedAppRevocationErrorCode>
>;

type Signer = ReturnType<Pubky["signer"]>;
type PublicKeyParseResult<ErrorCode extends string> = ResultType<
  PublicKey,
  CodedFailure<ErrorCode>
>;
const PASSPORT_CLIENT_ID = "passport.pubky.app";
/** What the SDK's `signin(clientId)` grants: root storage access, no encryption keys. */
const PASSPORT_SESSION_CAPABILITIES = "/:rw";
/** Passport's own sessions last seconds; anything older than this is a leftover. */
const LEFTOVER_PASSPORT_GRANT_MIN_AGE_SECONDS = 10 * 60;
/** How far the homeserver's clock may run ahead of the browser's for a grant to count as new. */
const GRANT_CLOCK_SKEW_SECONDS = 60;
/** Message of the SDK signer's refusal of a sign-in request for another key. */
const EXPECTED_SIGNER_REFUSAL = "this sign-in request is for a different key";

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

  /** Attempts the Pubky Ring handoff and consumes the migration after a navigation attempt. */
  navigate(): boolean {
    const migrationUrl = this.url;
    if (!migrationUrl) return false;
    try {
      globalThis.location.assign(migrationUrl);
      return true;
    } finally {
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
 * Browser-local Pubky adapter. Opaque handles keep SDK keypairs out of application and
 * UI state while this adapter owns all SDK resource cleanup.
 */
export class PubkySdkAdapter {
  private readonly pubky = new Pubky();
  private readonly keypairs = new Map<PubkyIdentityKeyHandle, Keypair>();
  private disposed = false;

  constructor(
    private readonly sessionLedger: PassportSessionLedger = browserPassportSessionLedger,
  ) {}

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

  /**
   * Decrypts a recovery file (`pubky.org/recovery`, as written by {@link createRecoveryFile}, or
   * the legacy `pkarr.org/recovery`) and registers its key. A file without a recovery header is
   * `invalid_recovery_file`; a wrong passphrase or damaged ciphertext is
   * `recovery_file_undecryptable`. The caller's file bytes are cleared either way.
   */
  importRecoveryFile(recoveryFile: Uint8Array, passphrase: string): PubkyRecoveryFileImportResult {
    try {
      if (this.disposed) {
        return failure("import_recovery_file", "adapter_state", "key_unavailable");
      }
      if (!hasRecoveryFileShape(recoveryFile)) {
        return failure("import_recovery_file", "input_validation", "invalid_recovery_file");
      }
      if (passphrase.length === 0) {
        return failure("import_recovery_file", "input_validation", "recovery_file_undecryptable");
      }
      let keypair: Keypair;
      try {
        keypair = Keypair.fromRecoveryFile(recoveryFile, passphrase);
      } catch (e) {
        return failure(
          "import_recovery_file",
          "sdk_recovery_file",
          "recovery_file_undecryptable",
          e,
        );
      }
      const registered = this.registerKeypair("import_recovery_file", keypair);
      return Result.isError(registered)
        ? failure("import_recovery_file", "sdk_public_identity", "invalid_recovery_file")
        : Result.ok(registered.value);
    } finally {
      cleanup("import_recovery_file", "recovery_file_clear", () => recoveryFile.fill(0));
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
      const opened = this.rememberPassportSession(
        "signin",
        keypair,
        await optionalSessionGrantId("signin", session),
      );
      try {
        return Result.ok(authenticatedIdentityFromSession("signin", session));
      } finally {
        // A failed signout is only logged: it must not turn a working sign-in into a failure.
        await this.closePassportSession("signin", session, opened);
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
    approvedCapabilities: string,
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
        signer.approveAuthWithCapabilities(sensitivePubkyAuthUrl, approvedCapabilities),
      );

      return Result.ok();
    } catch (e) {
      return failure(
        "approve_auth_request",
        "sdk_approval",
        isExpectedSignerRefusal(e) ? "expected_signer_mismatch" : "approval_failed",
        e,
      );
    }
  }

  /**
   * Lists the apps this identity authorized. Signs in with a short-lived root session and hides
   * that session's own grant by id. Grants of earlier Passport sessions from this browser whose
   * signout never reached the homeserver are revoked here; one that cannot be revoked stays
   * listed so the user can revoke it.
   */
  async listAuthorizedApps(keyHandle: PubkyIdentityKeyHandle): Promise<PubkyAuthorizedAppsResult> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return failure("list_authorized_apps", "key_lookup", "key_unavailable");
    }

    try {
      const apps = await this.withGrantManager(
        "list_authorized_apps",
        keypair,
        async (manager, sessionGrantId) => {
          const owner = publicIdentity("list_authorized_apps", keypair);
          const ownerZ32 = Result.isError(owner) ? undefined : owner.value.publicKeyZ32;
          // Read before listing: every grant recorded by then already exists on the homeserver.
          const recorded = ownerZ32 ? this.sessionLedger.recorded(ownerZ32) : new Set<string>();
          const grants = await manager.list();
          try {
            // Read again after listing: a Passport operation that opened its session while the
            // list was in flight (another tab, or a second load in React StrictMode) has recorded
            // it by now, or has already signed out and moved it to the recently closed record.
            const open = ownerZ32 ? this.sessionLedger.recorded(ownerZ32) : new Set<string>();
            const closed = ownerZ32
              ? this.sessionLedger.recentlyClosed(ownerZ32)
              : new Set<string>();
            const nowSeconds = Math.floor(Date.now() / 1000);
            const apps: PubkyAuthorizedApp[] = [];
            const settled = new Set<string>();
            for (const grant of grants) {
              if (grant.grantId === sessionGrantId) continue;
              // A running Passport operation's session: its signout removes it, so listing it
              // would show an app that is gone a moment later.
              if (
                (recorded.has(grant.grantId) ||
                  open.has(grant.grantId) ||
                  closed.has(grant.grantId)) &&
                isRunningPassportSession(grant, nowSeconds)
              ) {
                continue;
              }
              if (
                recorded.has(grant.grantId) &&
                isLeftoverPassportGrant(grant, nowSeconds) &&
                (await revokeLeftoverPassportGrant(manager, grant.grantId))
              ) {
                settled.add(grant.grantId);
                continue;
              }
              apps.push(authorizedApp(grant));
            }
            if (ownerZ32) {
              // Recorded grants the homeserver no longer lists were revoked or expired. This
              // session's own record is left to its signout.
              const listed = new Set(grants.map((grant) => grant.grantId));
              for (const grantId of recorded) {
                if (grantId !== sessionGrantId && !listed.has(grantId)) settled.add(grantId);
              }
              this.sessionLedger.forget(ownerZ32, [...settled]);
            }
            return Object.freeze(apps);
          } finally {
            for (const grant of grants) {
              cleanup("list_authorized_apps", "grant_info_free", () => grant.free());
            }
          }
        },
      );
      return Result.ok(apps);
    } catch (e) {
      return failure("list_authorized_apps", "sdk_grants", "list_failed", e);
    }
  }

  /** Revokes one grant issued by this identity. */
  async revokeAuthorizedApp(
    keyHandle: PubkyIdentityKeyHandle,
    grantId: string,
  ): Promise<PubkyAuthorizedAppRevocationResult> {
    if (grantId.trim().length === 0) {
      return failure("revoke_authorized_app", "input_validation", "invalid_grant_id");
    }

    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return failure("revoke_authorized_app", "key_lookup", "key_unavailable");
    }

    try {
      const revoked = await this.withGrantManager(
        "revoke_authorized_app",
        keypair,
        async (manager, sessionGrantId) => {
          // The session's own grant is removed by signout; it is never offered for revocation.
          if (grantId === sessionGrantId) return false;
          try {
            await manager.revoke(grantId);
          } catch (e) {
            // A grant the homeserver no longer knows is already in the requested state. Only the
            // revoke call gets this rule; a 404 from the root sign-in is a failure.
            if (requestStatus(e) !== 404) throw e;
          }
          return true;
        },
      );
      return revoked
        ? Result.ok()
        : failure("revoke_authorized_app", "input_validation", "invalid_grant_id");
    } catch (e) {
      return failure("revoke_authorized_app", "sdk_grants", "revoke_failed", e);
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
    operation: "create_identity_key" | "import_recovery_file" | "restore_identity_key",
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

  /**
   * Runs one grant-management call with a root session that is signed out and freed afterwards.
   * `sessionGrantId` is the grant backing that session, so callers can hide it.
   */
  private async withGrantManager<OperationResult>(
    operationName: "list_authorized_apps" | "revoke_authorized_app",
    keypair: Keypair,
    operation: (
      manager: GrantManager,
      sessionGrantId: string | undefined,
    ) => Promise<OperationResult>,
  ): Promise<OperationResult> {
    let session: Session | undefined;
    let manager: GrantManager | undefined;
    let opened: OpenedPassportSession | undefined;
    try {
      session = await this.withSigner(operationName, keypair, (signer) =>
        signer.signin(PASSPORT_CLIENT_ID),
      );
      const sessionGrantId = await sessionGrantIdOf(operationName, session);
      opened = this.rememberPassportSession(operationName, keypair, sessionGrantId);
      manager = new GrantManager(session);
      return await operation(manager, sessionGrantId);
    } finally {
      cleanup(operationName, "grant_manager_free", () => manager?.free());
      if (session) {
        await this.closePassportSession(operationName, session, opened);
      }
      cleanup(operationName, "session_free", () => session?.free());
    }
  }

  /** Records a Passport session's grant until its signout succeeds. */
  private rememberPassportSession(
    operation: PubkyOperation,
    keypair: Keypair,
    grantId: string | undefined,
  ): OpenedPassportSession | undefined {
    if (!grantId) return undefined;
    const identity = publicIdentity(operation, keypair);
    if (Result.isError(identity)) return undefined;
    this.sessionLedger.record(identity.value.publicKeyZ32, grantId);
    return { publicKeyZ32: identity.value.publicKeyZ32, grantId };
  }

  /** Signs out; the record stays when the signout fails, so Authorized apps can clean it up. */
  private async closePassportSession(
    operation: PubkyOperation,
    session: Session,
    opened: OpenedPassportSession | undefined,
  ): Promise<void> {
    const signedOut = await signout(operation, session);
    if (signedOut && opened) this.sessionLedger.forget(opened.publicKeyZ32, [opened.grantId]);
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

/**
 * The SDK signer refuses a grant sign-in whose `spk` names another key before it signs or
 * sends anything.
 */
function isExpectedSignerRefusal(error: unknown): boolean {
  try {
    return (
      safePubkySdkErrorName(error) === "AuthenticationError" &&
      typeof (error as { message?: unknown }).message === "string" &&
      isExpectedSignerRefusalMessage((error as { message: string }).message)
    );
  } catch {
    return false;
  }
}

/** The SDK prefixes its error chain ("Authentication error: ...: <reason>"); match the reason only. */
function isExpectedSignerRefusalMessage(message: string): boolean {
  return message === EXPECTED_SIGNER_REFUSAL || message.endsWith(`: ${EXPECTED_SIGNER_REFUSAL}`);
}

/**
 * A recorded grant that Passport's own short-lived root session left behind: Passport's client
 * id, root access only, and older than any Passport operation still running in another tab.
 * The record proves this browser's Passport opened it; the client id alone would not, because
 * an app can request a grant under any client id.
 */
function isLeftoverPassportGrant(grant: GrantInfo, nowSeconds: number): boolean {
  return (
    isPassportSessionGrant(grant) &&
    grant.issuedAt <= nowSeconds - LEFTOVER_PASSPORT_GRANT_MIN_AGE_SECONDS
  );
}

/**
 * A recorded Passport session young enough to belong to an operation that is still running. A
 * grant dated further ahead than clock skew explains stays listed, so a wrong clock can never
 * hide a grant for longer than ten minutes.
 */
function isRunningPassportSession(grant: GrantInfo, nowSeconds: number): boolean {
  return (
    isPassportSessionGrant(grant) &&
    Number.isFinite(grant.issuedAt) &&
    grant.issuedAt > nowSeconds - LEFTOVER_PASSPORT_GRANT_MIN_AGE_SECONDS &&
    grant.issuedAt <= nowSeconds + GRANT_CLOCK_SKEW_SECONDS
  );
}

function isPassportSessionGrant(grant: GrantInfo): boolean {
  return (
    grant.clientId === PASSPORT_CLIENT_ID &&
    grantCapabilities(grant).join(",") === PASSPORT_SESSION_CAPABILITIES
  );
}

/** Best effort: a leftover that cannot be revoked now stays listed for the user. */
async function revokeLeftoverPassportGrant(
  manager: GrantManager,
  grantId: string,
): Promise<boolean> {
  try {
    await manager.revoke(grantId);
    return true;
  } catch (e) {
    // Another tab may have revoked it first: a grant the homeserver no longer knows is gone.
    if (requestStatus(e) === 404) return true;
    LOGGER.warn("identity.pubky.cleanup.failed", {
      operation: "list_authorized_apps",
      stage: "leftover_grant_revoke",
      code: "cleanup_failed",
      ...safeErrorLogFields(e),
    });
    return false;
  }
}

function grantCapabilities(grant: GrantInfo): string[] {
  return grant.capabilities
    .split(",")
    .map((capability) => capability.trim())
    .filter((capability) => capability.length > 0);
}

function authorizedApp(grant: GrantInfo): PubkyAuthorizedApp {
  return Object.freeze({
    grantId: grant.grantId,
    clientId: grant.clientId,
    capabilities: Object.freeze(grantCapabilities(grant)),
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  });
}

type OpenedPassportSession = { publicKeyZ32: string; grantId: string };

/** Never throws; returns whether the homeserver confirmed the signout. */
async function signout(operation: PubkyOperation, session: Session): Promise<boolean> {
  try {
    await session.signout();
    return true;
  } catch (e) {
    LOGGER.warn("identity.pubky.cleanup.failed", {
      operation,
      stage: "session_signout",
      code: "cleanup_failed",
      ...safeErrorLogFields(e),
    });
    return false;
  }
}

/** The id of the grant behind a session; a failure propagates to the caller. */
async function sessionGrantIdOf(
  operation: PubkyOperation,
  session: Session,
): Promise<string | undefined> {
  const grantSession = session.grant;
  if (!grantSession) return undefined;
  try {
    return await grantSession.grantId();
  } finally {
    cleanup(operation, "grant_session_free", () => grantSession.free());
  }
}

/** Like {@link sessionGrantIdOf}, for callers whose result must not depend on the grant id. */
async function optionalSessionGrantId(
  operation: PubkyOperation,
  session: Session,
): Promise<string | undefined> {
  try {
    return await sessionGrantIdOf(operation, session);
  } catch (e) {
    LOGGER.warn("identity.pubky.cleanup.failed", {
      operation,
      stage: "session_grant_id",
      code: "cleanup_failed",
      ...safeErrorLogFields(e),
    });
    return undefined;
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
  | "export_secret_key"
  | "import_recovery_file"
  | "list_authorized_apps"
  | "publish_homeserver"
  | "resolve_homeserver"
  | "restore_identity_key"
  | "revoke_authorized_app"
  | "signin"
  | "signup";

type PubkyFailureStage =
  | "adapter_state"
  | "homeserver_parse"
  | "input_validation"
  | "key_lookup"
  | "request_validation"
  | "sdk_approval"
  | "sdk_create"
  | "sdk_export"
  | "sdk_grants"
  | "sdk_initialize"
  | "sdk_public_identity"
  | "sdk_recovery_file"
  | "sdk_publish"
  | "sdk_resolution"
  | "sdk_restore"
  | "sdk_signin"
  | "sdk_signup";

type PubkyCleanupStage =
  | "grant_info_free"
  | "grant_manager_free"
  | "grant_session_free"
  | "homeserver_free"
  | "keypair_free"
  | "pkdns_free"
  | "pubky_free"
  | "public_key_free"
  | "recovery_file_clear"
  | "secret_key_clear"
  | "session_free"
  | "session_info_free"
  | "session_public_key_free"
  | "signer_free";

type PubkyErrorCode =
  | PubkyAuthApprovalErrorCode
  | PubkyAuthorizedAppRevocationErrorCode
  | PubkyAuthorizedAppsErrorCode
  | PubkyPublicationErrorCode
  | PubkyIdentityKeysErrorCode
  | PubkyRecoveryFileErrorCode
  | PubkyRecoveryFileImportErrorCode
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
    LOGGER.warn("identity.pubky.cleanup.failed", {
      operation,
      stage,
      code: "cleanup_failed",
      ...safeErrorLogFields(e),
    });
  }
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
