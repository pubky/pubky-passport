import "client-only";

import { Keypair, Pubky, PublicKey, type PubkyError, type Session } from "@synonymdev/pubky";
import { Result, type Result as ResultType } from "better-result";

import type { PubkyPublicIdentity } from "../identity/pubkyPublicIdentity";
import {
  getValidatedSensitivePubkyAuthUrl,
  isPubkyAuthApprovalCapability,
  type PubkyAuthApprovalCapability,
} from "../authorization/browserAuthorizationRequest";
import {
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
  type PubkyIdentityKeyHandle,
  type PubkyIdentityKeysErrorCode,
  type PubkyIdentityKeysResult,
  type PubkySecretKeyMaterial,
} from "./pubkyIdentityKey";
import { LOGGER } from "../../../libs/logger/logger";

export type PubkyIdentitySession = {
  publicIdentity: PubkyPublicIdentity;
};

export type PubkySessionAccessErrorCode =
  | "account_exists"
  | "invalid_homeserver_pubky"
  | "key_unavailable"
  | "signin_failed"
  | "signup_failed"
  | "signup_uncertain";
export type PubkySessionAccessResult<Success> = ResultType<Success, { code: PubkySessionAccessErrorCode }>;
export type PubkyDiscoveryErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "publish_failed";
export type PubkyDiscoveryResult = ResultType<void, { code: PubkyDiscoveryErrorCode }>;
export type PubkyHomeserverResolutionResult = ResultType<string | null, { code: "invalid_pubky" | "resolution_failed" }>;
export type PubkyRecoveryFileErrorCode = "invalid_passphrase" | "invalid_secret_key" | "key_unavailable" | "recovery_file_failed";
export type PubkyRecoveryFileResult = ResultType<Uint8Array, { code: PubkyRecoveryFileErrorCode }>;
export type PubkyAuthApprovalErrorCode = "approval_failed" | "key_unavailable" | "relay_failed" | "request_rejected";
export type PubkyAuthApprovalResult = ResultType<void, { code: PubkyAuthApprovalErrorCode }>;

type Signer = ReturnType<Pubky["signer"]>;
type HomeserverResult = ResultType<PublicKey, { code: "invalid_homeserver_pubky" }>;
const PASSPORT_CLIENT_ID = "passport.pubky.app";

export type PubkySignupInput = {
  keyHandle: PubkyIdentityKeyHandle;
  homeserverPubky: string;
  signupCode?: string | null;
};

export type PubkyDiscoveryInput = {
  keyHandle: PubkyIdentityKeyHandle;
  homeserverPubky?: string | null;
};

/**
 * Browser-local Pubky adapter. Opaque handles keep SDK keypairs out of application and
 * UI state while this adapter owns all SDK resource cleanup.
 */
export class PubkySdkAdapter {
  private pubky: Pubky;
  private keypairs = new Map<PubkyIdentityKeyHandle, Keypair>();
  private disposed = false;

  constructor() {
    this.pubky = new Pubky();
  }

  async createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    if (this.disposed) {
      return keyFailure("create_identity_key", "adapter_state", "key_unavailable");
    }

    try {
      return this.registerKeypair("create_identity_key", Keypair.random());
    } catch {
      return keyFailure("create_identity_key", "sdk_create", "create_failed");
    }
  }

  async restoreIdentityKey(secretKey: PubkySecretKeyMaterial): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    if (this.disposed) {
      clearSecretKey(secretKey);
      return keyFailure("restore_identity_key", "adapter_state", "key_unavailable");
    }

    if (!(secretKey.bytes instanceof Uint8Array) || secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      clearSecretKey(secretKey);
      return keyFailure("restore_identity_key", "input_validation", "invalid_secret_key");
    }

    try {
      return this.registerKeypair("restore_identity_key", Keypair.fromSecret(secretKey.bytes));
    } catch {
      return keyFailure("restore_identity_key", "sdk_restore", "restore_failed");
    } finally {
      clearSecretKey(secretKey);
    }
  }

  createRecoveryFile(secretKey: PubkySecretKeyMaterial, passphrase: string): PubkyRecoveryFileResult {
    if (this.disposed) {
      clearSecretKey(secretKey, "create_recovery_file");
      return recoveryFileFailure("adapter_state", "key_unavailable");
    }
    if (!(secretKey.bytes instanceof Uint8Array) || secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      clearSecretKey(secretKey, "create_recovery_file");
      return recoveryFileFailure("input_validation", "invalid_secret_key");
    }
    if (passphrase.length === 0) {
      clearSecretKey(secretKey, "create_recovery_file");
      return recoveryFileFailure("input_validation", "invalid_passphrase");
    }

    let keypair: Keypair | undefined;
    try {
      keypair = Keypair.fromSecret(secretKey.bytes);
      return Result.ok(keypair.createRecoveryFile(passphrase));
    } catch {
      return recoveryFileFailure("sdk_recovery_file", "recovery_file_failed");
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

  async exportSecretKey(keyHandle: PubkyIdentityKeyHandle): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return keyFailure("export_secret_key", "key_lookup", "key_unavailable");
    }

    try {
      return Result.ok({
        bytes: keypair.secret(),
        format: PUBKY_SECRET_KEY_FORMAT,
      });
    } catch {
      return keyFailure("export_secret_key", "sdk_export", "export_failed");
    }
  }

  async getPublicIdentity(keyHandle: PubkyIdentityKeyHandle): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return keyFailure("get_public_identity", "key_lookup", "key_unavailable");
    }

    const identity = publicIdentity("get_public_identity", keypair);
    return Result.isError(identity)
      ? keyFailure("get_public_identity", "sdk_public_identity", identity.error.code)
      : identity;
  }

  async signup(input: PubkySignupInput): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    const keypair = this.keypairFor(input.keyHandle);
    if (!keypair) {
      return sessionAccessFailure("signup", "key_lookup", "key_unavailable");
    }

    const homeserver = parseHomeserver(input.homeserverPubky);
    if (Result.isError(homeserver)) {
      return sessionAccessFailure("signup", "homeserver_parse", homeserver.error.code);
    }

    try {
      await this.withSigner("signup", keypair, (signer) => signer.signup(homeserver.value, input.signupCode ?? null));
      const identity = publicIdentity("signup", keypair);
      if (Result.isError(identity)) {
        return sessionAccessFailure("signup", "sdk_public_identity", "signup_failed");
      }

      return Result.ok({ publicIdentity: identity.value });
    } catch (error) {
      const status = requestStatus(error);
      return sessionAccessFailure(
        "signup",
        "sdk_signup",
        status === 409
          ? "account_exists"
          : isDefinitiveSignupRejection(error, status)
            ? "signup_failed"
            : "signup_uncertain",
        error,
      );
    } finally {
      cleanup("signup", "homeserver_free", () => homeserver.value.free());
    }
  }

  async signin(keyHandle: PubkyIdentityKeyHandle): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return sessionAccessFailure("signin", "key_lookup", "key_unavailable");
    }

    let session: Session | undefined;
    try {
      session = await this.withSigner("signin", keypair, (signer) => signer.signinBlocking(PASSPORT_CLIENT_ID));
      const details = sessionDetails("signin", session);
      await session.signout();

      return Result.ok(details);
    } catch (error) {
      return sessionAccessFailure("signin", "sdk_signin", "signin_failed", error);
    } finally {
      cleanup("signin", "session_free", () => session?.free());
    }
  }

  async resolveHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult> {
    const identity = parseHomeserver(publicKeyZ32);
    if (Result.isError(identity)) return Result.err({ code: "invalid_pubky" });

    let homeserver: PublicKey | undefined;
    try {
      homeserver = await this.pubky.getHomeserverOf(identity.value);
      return Result.ok(homeserver?.z32() ?? null);
    } catch {
      return Result.err({ code: "resolution_failed" });
    } finally {
      cleanup("resolve_homeserver", "homeserver_free", () => homeserver?.free());
      cleanup("resolve_homeserver", "public_key_free", () => identity.value.free());
    }
  }

  async publishHomeserverForce(input: PubkyDiscoveryInput): Promise<PubkyDiscoveryResult> {
    return this.publishHomeserver(input.keyHandle, input.homeserverPubky);
  }

  async approveAuthRequest(keyHandle: PubkyIdentityKeyHandle, authRequest: PubkyAuthApprovalCapability): Promise<PubkyAuthApprovalResult> {
    if (!isPubkyAuthApprovalCapability(authRequest)) {
      return authApprovalFailure("approve_auth_request", "request_validation", "request_rejected");
    }

    const sensitivePubkyAuthUrl = getValidatedSensitivePubkyAuthUrl(authRequest);
    if (sensitivePubkyAuthUrl === undefined || !isPubkyAuthRequestUrl(sensitivePubkyAuthUrl)) {
      return authApprovalFailure("approve_auth_request", "request_validation", "request_rejected");
    }

    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return authApprovalFailure("approve_auth_request", "key_lookup", "key_unavailable");
    }

    try {
      await this.withSigner("approve_auth_request", keypair, (signer) => signer.approveAuthRequest(sensitivePubkyAuthUrl));

      return Result.ok();
    } catch {
      return authApprovalFailure("approve_auth_request", "sdk_approval", "approval_failed");
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

  private registerKeypair(operation: "create_identity_key" | "restore_identity_key", keypair: Keypair): PubkyIdentityKeysResult<PubkyIdentityKey> {
    const identity = publicIdentity(operation, keypair);
    if (Result.isError(identity)) {
      cleanup(operation, "keypair_free", () => keypair.free());
      return keyFailure(operation, "sdk_public_identity", identity.error.code);
    }

    const keyHandle = {} as PubkyIdentityKeyHandle;
    this.keypairs.set(keyHandle, keypair);

    return Result.ok({ keyHandle, publicIdentity: identity.value });
  }

  private async publishHomeserver(
    keyHandle: PubkyIdentityKeyHandle,
    homeserverPubky?: string | null,
  ): Promise<PubkyDiscoveryResult> {
    const keypair = this.keypairFor(keyHandle);
    if (!keypair) {
      return discoveryFailure("publish_homeserver", "key_lookup", "key_unavailable");
    }

    const homeserver = parseOptionalHomeserver(homeserverPubky);
    if (Result.isError(homeserver)) {
      return discoveryFailure("publish_homeserver", "homeserver_parse", homeserver.error.code);
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
    } catch {
      return discoveryFailure("publish_homeserver", "sdk_publish", "publish_failed");
    } finally {
      if (!transferredToSdk) {
        cleanup("publish_homeserver", "homeserver_free", () => homeserver.value?.free());
      }
    }
  }

  private keypairFor(keyHandle: PubkyIdentityKeyHandle): Keypair | undefined {
    return this.disposed ? undefined : this.keypairs.get(keyHandle);
  }

  private async withSigner<OperationResult>(operationName: PubkyOperation, keypair: Keypair, operation: (signer: Signer) => Promise<OperationResult>): Promise<OperationResult> {
    const signer = this.pubky.signer(keypair);
    try {
      return await operation(signer);
    } finally {
      cleanup(operationName, "signer_free", () => signer.free());
    }
  }
}

export async function resolvePubkyHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult> {
  const pubky = new PubkySdkAdapter();
  try {
    return await pubky.resolveHomeserver(publicKeyZ32);
  } finally {
    pubky.dispose();
  }
}

function publicIdentity(operation: PubkyOperation, keypair: Keypair): PubkyIdentityKeysResult<PubkyPublicIdentity> {
  try {
    const publicKey = keypair.publicKey;
    try {
      return Result.ok({
        publicKeyZ32: publicKey.z32(),
        publicKeyDisplay: publicKey.toString(),
      });
    } finally {
      cleanup(operation, "public_key_free", () => publicKey.free());
    }
  } catch {
    return Result.err({ code: "public_identity_failed" });
  }
}

function parseHomeserver(value: string): HomeserverResult {
  if (value.trim().length === 0) {
    return Result.err({ code: "invalid_homeserver_pubky" });
  }

  try {
    return Result.ok(PublicKey.from(value));
  } catch {
    return Result.err({ code: "invalid_homeserver_pubky" });
  }
}

function parseOptionalHomeserver(value: string | null | undefined): ResultType<PublicKey | null, { code: "invalid_homeserver_pubky" }> {
  return value === null || value === undefined ? Result.ok(null) : parseHomeserver(value);
}

function isPubkyAuthRequestUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "pubkyauth:";
  } catch {
    return false;
  }
}

function sessionDetails(operation: "signup" | "signin", session: Session): PubkyIdentitySession {
  const info = session.info;
  const publicKey = info.publicKey;
  try {
    return {
      publicIdentity: {
        publicKeyZ32: publicKey.z32(),
        publicKeyDisplay: publicKey.toString(),
      },
    };
  } finally {
    cleanup(operation, "session_public_key_free", () => publicKey.free());
    cleanup(operation, "session_info_free", () => info.free());
  }
}

type PubkyOperation =
  | "approve_auth_request"
  | "create_identity_key"
  | "create_recovery_file"
  | "dispose_adapter"
  | "dispose_identity_key"
  | "export_secret_key"
  | "get_public_identity"
  | "publish_homeserver"
  | "resolve_homeserver"
  | "restore_identity_key"
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
  | "sdk_public_identity"
  | "sdk_recovery_file"
  | "sdk_publish"
  | "sdk_restore"
  | "sdk_signin"
  | "sdk_signup";

type PubkyCleanupStage =
  | "homeserver_free"
  | "keypair_free"
  | "pkdns_free"
  | "pubky_free"
  | "public_key_free"
  | "secret_key_clear"
  | "session_free"
  | "session_info_free"
  | "session_public_key_free"
  | "signer_free";

type PubkyErrorCode =
  | PubkyAuthApprovalErrorCode
  | PubkyDiscoveryErrorCode
  | PubkyIdentityKeysErrorCode
  | PubkyRecoveryFileErrorCode
  | PubkySessionAccessErrorCode;

function keyFailure<Success>(operation: PubkyOperation, stage: PubkyFailureStage, code: PubkyIdentityKeysErrorCode): PubkyIdentityKeysResult<Success> {
  logFailure(operation, stage, code);
  return Result.err({ code });
}

function recoveryFileFailure(stage: PubkyFailureStage, code: PubkyRecoveryFileErrorCode): PubkyRecoveryFileResult {
  logFailure("create_recovery_file", stage, code);
  return Result.err({ code });
}

function sessionAccessFailure<Success>(
  operation: "signin" | "signup",
  stage: PubkyFailureStage,
  code: PubkySessionAccessErrorCode,
  cause?: unknown,
): PubkySessionAccessResult<Success> {
  logFailure(operation, stage, code, cause);
  return Result.err({ code });
}

function discoveryFailure(operation: "publish_homeserver", stage: PubkyFailureStage, code: PubkyDiscoveryErrorCode): PubkyDiscoveryResult {
  logFailure(operation, stage, code);
  return Result.err({ code });
}

function authApprovalFailure(operation: "approve_auth_request", stage: PubkyFailureStage, code: PubkyAuthApprovalErrorCode): PubkyAuthApprovalResult {
  logFailure(operation, stage, code);
  return Result.err({ code });
}

function logFailure(operation: PubkyOperation, stage: PubkyFailureStage, code: PubkyErrorCode, cause?: unknown): void {
  const sdkErrorName = safePubkySdkErrorName(cause);
  LOGGER.warn("identity.pubky.operation.failed", {
    operation,
    stage,
    code,
    ...(sdkErrorName ? { sdkErrorName } : {}),
  });
}

function safePubkySdkErrorName(error: unknown): string | undefined {
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
}

function requestStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || (error as Partial<PubkyError>).name !== "RequestError") {
    return undefined;
  }
  const data = (error as Partial<PubkyError>).data;
  if (typeof data !== "object" || data === null || !("statusCode" in data)) return undefined;
  const statusCode = (data as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" && Number.isInteger(statusCode) ? statusCode : undefined;
}

function isDefinitiveSignupRejection(error: unknown, status: number | undefined): boolean {
  const errorName = safePubkySdkErrorName(error);
  return errorName === "AuthenticationError"
    || errorName === "ClientStateError"
    || errorName === "InvalidInput"
    || status === 400
    || status === 401
    || status === 403
    || status === 404
    || status === 422;
}

function cleanup(operation: PubkyOperation, stage: PubkyCleanupStage, action: () => void): void {
  try {
    action();
  } catch {
    LOGGER.warn("identity.pubky.cleanup.failed", {
      operation,
      stage,
      code: "cleanup_failed",
    });
  }
}

function clearSecretKey(secretKey: PubkySecretKeyMaterial, operation: "create_recovery_file" | "restore_identity_key" = "restore_identity_key"): void {
  cleanup(operation, "secret_key_clear", () => secretKey.bytes.fill(0));
}
