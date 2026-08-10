import "client-only";

import { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";
import type { GoogleAccountProfile } from "../../core/identity/googleAccountProfile";
import { LOGGER } from "../../libs/logger/logger";
import type {
  GoogleBackedIdentityCredentials,
  GoogleBackedIdentityError,
  GoogleBackedIdentityResult,
} from "./google-backed/googleBackedIdentityOperations";
import type {
  GoogleIdentityBackupDeletionError,
  GoogleIdentityBackupDeletionResult,
} from "./google-backed/deleteGoogleIdentityBackups";
import type {
  GoogleBackedIdentityProgress,
  ReportGoogleBackedIdentityProgress,
} from "./google-backed/googleBackedIdentityProgress";
import type {
  GoogleAuthorizationCodeErrorCode,
  GoogleAuthorizationCodeResult,
} from "../google-authorization/googleAuthorizationCode";
import type { PubkyHomeserverResolutionResult } from "../pubky/pubkySdkAdapter";
import type { LocalIdentityBackupResult } from "./local/createLocalIdentityBackup";
import type {
  LocalIdentityErrorCode,
  LocalIdentityResult,
  LocalIdentitySummary,
} from "./local/localStorageIdentityRepository";

export type { LocalIdentitySummary } from "./local/localStorageIdentityRepository";

export type PassportIdentityList = {
  activeIdentityId: string | null;
  identities: LocalIdentitySummary[];
};

export type PassportIdentityCatalogResult<T> = Result<T, { code: LocalIdentityErrorCode }>;

export type PassportIdentityControllerErrorCode =
  | "wrapping_key_failed"
  | "wrapping_key_rate_limited"
  | "wrapping_key_unavailable"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "create_failed"
  | "encrypt_failed"
  | "drive_create_conflict"
  | "drive_write_failed"
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed"
  | "signup_failed"
  | "signin_failed"
  | "discovery_failed"
  | "local_save_failed"
  | "local_remove_failed"
  | "drive_stale_file"
  | "drive_delete_failed"
  | "unexpected_failure";

export type PassportIdentityControllerError = {
  code: PassportIdentityControllerErrorCode;
  preservedPassportFileIdentity?: PubkyPublicIdentity;
  recovery?: {
    googleAccount: GoogleAccountProfile;
    publicIdentity: PubkyPublicIdentity;
  };
  warning?: "visible_recovery_copy_unconfirmed";
};

export type GoogleBackedIdentityAction =
  | { kind: "establish_google_backed_identity" }
  | {
    kind: "detach_google_backed_identity";
    publicIdentity: PubkyPublicIdentity;
    expectedGoogleAccountId: string;
  }
  | {
    kind: "replace_incomplete_google_backed_identity";
    publicIdentity: PubkyPublicIdentity;
    expectedGoogleAccountId: string;
  };

export type GoogleBackedIdentityActionResult = Result<
  | {
    kind: "google_backed_identity_established";
    establishmentMode: "created";
    publicIdentity: PubkyPublicIdentity;
    visibleRecoveryCopyStatus: "created" | "unconfirmed";
  }
  | {
    kind: "google_backed_identity_established";
    establishmentMode: "restored";
    publicIdentity: PubkyPublicIdentity;
  }
  | { kind: "google_backed_identity_detached"; deletionStatus: "deleted" | "missing" },
  PassportIdentityControllerError
>;

export type GoogleBackedIdentityActionErrorCode =
  | "google_authorization_unavailable"
  | "google_drive_authorization_failed"
  | "google_drive_authorization_popup_closed"
  | "google_drive_authorization_popup_failed_to_open"
  | "google_drive_authorization_account_mismatch"
  | "google_drive_authorization_account_verification_failed";

export type GoogleBackedIdentityActionState =
  | { stage: "google-authorization"; errorCode: GoogleBackedIdentityActionErrorCode | null }
  | { stage: "requesting-google-authorization" }
  | { stage: "establishing-google-backed-identity"; progress: GoogleBackedIdentityProgress }
  | { stage: "detaching-google-backed-identity" };

export type GoogleBackedIdentityActionDispatchResult =
  | { status: "google_authorization_failed" }
  | { status: "busy" }
  | { status: "superseded" }
  | { status: "action_finished_after_unmount"; result: GoogleBackedIdentityActionResult }
  | { status: "action_completed"; result: GoogleBackedIdentityActionResult };

export type PassportIdentityControllerDependencies = {
  list(): LocalIdentityResult<{ activeIdentityId: string | null; identities: LocalIdentitySummary[] }>;
  select(id: string): LocalIdentityResult<void>;
  remove(id: string): LocalIdentityResult<void>;
  subscribe(listener: () => void): () => void;
  resolveHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult>;
  createBackup(identityId: string, password: string): Promise<LocalIdentityBackupResult>;
  createPubkyRingMigrationUrl(): LocalIdentityResult<string>;
  restoreOrCreateGoogleBackedIdentity(
    credentials: GoogleBackedIdentityCredentials,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<GoogleBackedIdentityResult>;
  deleteGoogleIdentityBackups(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<GoogleIdentityBackupDeletionResult>;
  disposeGoogleBackedIdentityOperations(): void;
  prepareGoogleAuthorization(): Promise<GoogleAuthorizationCodeResult<void>>;
  requestGoogleAuthorization(loginHint?: string): Promise<GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>>;
  disposeGoogleAuthorization(): void;
};

export class PassportIdentityController {
  readonly #dependencies: PassportIdentityControllerDependencies;
  #actionStateListener: ((state: GoogleBackedIdentityActionState) => void) | null = null;
  #authorizationSessionGeneration = 0;
  #authorizedActionPending = false;
  #disposed = false;
  #identityOperationsDisposed = false;

  constructor(dependencies: PassportIdentityControllerDependencies) {
    this.#dependencies = dependencies;
  }

  list(): PassportIdentityCatalogResult<PassportIdentityList> {
    return this.runCatalogOperation("list", () => this.#dependencies.list());
  }

  select(id: string): PassportIdentityCatalogResult<void> {
    return this.runCatalogOperation("select", () => this.#dependencies.select(id));
  }

  remove(id: string): PassportIdentityCatalogResult<void> {
    return this.runCatalogOperation("remove", () => this.#dependencies.remove(id));
  }

  subscribe(listener: () => void): () => void {
    let unsubscribe: () => void;
    try {
      unsubscribe = this.#dependencies.subscribe(listener);
    } catch {
      LOGGER.warn("identity.local_catalog.failed", {
        operation: "subscribe",
        code: "runtime_exception",
      });
      throw new Error("Identity subscription unavailable.");
    }
    return () => {
      try {
        unsubscribe();
      } catch {
        LOGGER.warn("identity.local_catalog.failed", {
          operation: "unsubscribe",
          code: "runtime_exception",
        });
        throw new Error("Identity subscription cleanup failed.");
      }
    };
  }

  resolveHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult> {
    return this.#dependencies.resolveHomeserver(publicKeyZ32);
  }

  createBackup(identityId: string, password: string): Promise<LocalIdentityBackupResult> {
    return this.#dependencies.createBackup(identityId, password);
  }

  createPubkyRingMigrationUrl(): PassportIdentityCatalogResult<string> {
    return this.runCatalogOperation(
      "create_pubky_ring_migration",
      () => this.#dependencies.createPubkyRingMigrationUrl(),
    );
  }

  async prepareGoogleAuthorization(
    onState: (state: GoogleBackedIdentityActionState) => void,
  ): Promise<void> {
    this.disposeGoogleAuthorization();
    if (this.#disposed) return;
    this.#actionStateListener = onState;
    const authorizationSessionGeneration = ++this.#authorizationSessionGeneration;
    let prepared: GoogleAuthorizationCodeResult<void>;
    try {
      prepared = await this.#dependencies.prepareGoogleAuthorization();
    } catch {
      if (authorizationSessionGeneration === this.#authorizationSessionGeneration) {
        this.showGoogleUnavailable();
      }
      return;
    }
    if (!this.isCurrentAuthorizationSession(authorizationSessionGeneration)) return;
    if (Result.isError(prepared)) this.showGoogleUnavailable();
    else this.emit({ stage: "google-authorization", errorCode: null });
  }

  disposeGoogleAuthorization(): void {
    try {
      this.#dependencies.disposeGoogleAuthorization();
    } finally {
      this.#actionStateListener = null;
      this.#authorizationSessionGeneration += 1;
    }
  }

  retryGoogleAuthorization(): void {
    const actionStateListener = this.#actionStateListener;
    if (!actionStateListener || this.#disposed || this.#authorizedActionPending) return;
    void this.prepareGoogleAuthorization(actionStateListener);
  }

  async continueGoogleBackedIdentityAction(
    action: GoogleBackedIdentityAction,
  ): Promise<GoogleBackedIdentityActionDispatchResult> {
    if (this.#authorizedActionPending) return { status: "busy" };
    if (this.#disposed) return { status: "superseded" };
    const authorizationSessionGeneration = this.#authorizationSessionGeneration;
    this.#authorizedActionPending = true;
    try {
      this.emit({ stage: "requesting-google-authorization" });
      const loginHint = action.kind === "establish_google_backed_identity"
        ? undefined
        : action.expectedGoogleAccountId;
      const credentials = await this.#dependencies.requestGoogleAuthorization(loginHint);
      if (!this.isCurrentAuthorizationSession(authorizationSessionGeneration)) {
        return { status: "superseded" };
      }
      if (Result.isError(credentials)) {
        this.resetGoogleAuthorization(errorForAuthorizationCodeFailure(credentials.error.code));
        return { status: "google_authorization_failed" };
      }
      if (
        action.kind !== "establish_google_backed_identity"
        && credentials.value.googleAccount.id !== action.expectedGoogleAccountId) {
        this.resetGoogleAuthorization("google_drive_authorization_account_mismatch");
        return { status: "google_authorization_failed" };
      }
      const result = await this.executeAuthorizedAction(
        action,
        credentials.value,
        authorizationSessionGeneration,
      );
      if (!this.isCurrentAuthorizationSession(authorizationSessionGeneration)) {
        return { status: "action_finished_after_unmount", result };
      }
      this.resetGoogleAuthorization();
      return { status: "action_completed", result };
    } catch {
      this.resetGoogleAuthorization("google_drive_authorization_failed");
      return { status: "google_authorization_failed" };
    } finally {
      this.#authorizedActionPending = false;
      if (this.#disposed) this.disposeGoogleBackedIdentityOperationsOnce();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.disposeGoogleAuthorization();
    } finally {
      if (!this.#authorizedActionPending) this.disposeGoogleBackedIdentityOperationsOnce();
    }
  }

  private async executeAuthorizedAction(
    action: GoogleBackedIdentityAction,
    credentials: GoogleBackedIdentityCredentials,
    authorizationSessionGeneration: number,
  ): Promise<GoogleBackedIdentityActionResult> {
    try {
      switch (action.kind) {
        case "detach_google_backed_identity": {
          this.emit({ stage: "detaching-google-backed-identity" });
          const deletionResult = await this.#dependencies.deleteGoogleIdentityBackups(
            credentials,
            action.publicIdentity,
            action.expectedGoogleAccountId,
          );
          if (Result.isError(deletionResult)) return deletionFailure(deletionResult.error);
          const removed = this.#dependencies.remove(action.publicIdentity.publicKeyZ32);
          return Result.isError(removed)
            ? Result.err({ code: "local_remove_failed" })
            : Result.ok({
              kind: "google_backed_identity_detached",
              deletionStatus: deletionResult.value.status,
            });
        }
        case "replace_incomplete_google_backed_identity": {
          this.emit({ stage: "establishing-google-backed-identity", progress: "checking_passport_file" });
          const deletionResult = await this.#dependencies.deleteGoogleIdentityBackups(
            credentials,
            action.publicIdentity,
            action.expectedGoogleAccountId,
          );
          if (Result.isError(deletionResult)) return deletionFailure(deletionResult.error);
          break;
        }
        case "establish_google_backed_identity":
          break;
      }
      let progressActive = true;
      const reportProgress: ReportGoogleBackedIdentityProgress = (progress) => {
        if (!progressActive
          || !this.isCurrentAuthorizationSession(authorizationSessionGeneration)) return;
        this.emit({ stage: "establishing-google-backed-identity", progress });
      };
      const establishmentResult = await this.#dependencies.restoreOrCreateGoogleBackedIdentity(
        credentials,
        reportProgress,
      ).finally(() => {
        progressActive = false;
      });
      if (Result.isError(establishmentResult)) {
        return establishmentFailure(establishmentResult.error, credentials.googleAccount);
      }
      return establishmentResult.value.establishmentMode === "created"
        ? Result.ok({
          kind: "google_backed_identity_established",
          establishmentMode: "created",
          publicIdentity: establishmentResult.value.publicIdentity,
          visibleRecoveryCopyStatus: establishmentResult.value.visibleRecoveryCopyStatus,
        })
        : Result.ok({
          kind: "google_backed_identity_established",
          establishmentMode: "restored",
          publicIdentity: establishmentResult.value.publicIdentity,
        });
    } catch {
      LOGGER.warn("identity.google.action.failed", { code: "unexpected_failure" });
      return Result.err({ code: "unexpected_failure" });
    }
  }

  private disposeGoogleBackedIdentityOperationsOnce(): void {
    if (this.#identityOperationsDisposed) return;
    this.#identityOperationsDisposed = true;
    try {
      this.#dependencies.disposeGoogleBackedIdentityOperations();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", { operation: "pubky_dispose" });
    }
  }

  private isCurrentAuthorizationSession(generation: number): boolean {
    return !this.#disposed && generation === this.#authorizationSessionGeneration;
  }

  private resetGoogleAuthorization(errorCode: GoogleBackedIdentityActionErrorCode | null = null): void {
    this.emit({ stage: "google-authorization", errorCode });
  }

  private showGoogleUnavailable(): void {
    this.emit({ stage: "google-authorization", errorCode: "google_authorization_unavailable" });
  }

  private runCatalogOperation<T>(
    operation: "list" | "select" | "remove" | "create_pubky_ring_migration",
    execute: () => LocalIdentityResult<T>,
  ): PassportIdentityCatalogResult<T> {
    try {
      return toCatalogResult(execute());
    } catch {
      LOGGER.warn("identity.local_catalog.failed", {
        operation,
        code: "runtime_exception",
      });
      return Result.err({ code: "storage_unavailable" });
    }
  }

  private emit(state: GoogleBackedIdentityActionState): void {
    if (this.#disposed) return;
    try { this.#actionStateListener?.(state); }
    catch { LOGGER.warn("identity.google.state_listener.failed"); }
  }
}

function toCatalogResult<T>(
  result: LocalIdentityResult<T>,
): PassportIdentityCatalogResult<T> {
  return Result.isError(result)
    ? Result.err({ code: result.error.code })
    : Result.ok(result.value);
}

function establishmentFailure(
  error: GoogleBackedIdentityError,
  googleAccount: GoogleAccountProfile,
): GoogleBackedIdentityActionResult {
  return Result.err({
    code: establishmentFailureCode(error),
    ...(error.preservedPassportFileIdentity
      ? {
        preservedPassportFileIdentity: error.preservedPassportFileIdentity,
        recovery: { googleAccount, publicIdentity: error.preservedPassportFileIdentity },
      }
      : {}),
    ...("warning" in error && error.warning ? { warning: error.warning } : {}),
  });
}

function deletionFailure(error: GoogleIdentityBackupDeletionError): GoogleBackedIdentityActionResult {
  return Result.err({
    code: error.code === "wrapping_key_failed"
      ? wrappingKeyFailureCode(error.cause)
      : error.code,
  });
}

function establishmentFailureCode(
  error: GoogleBackedIdentityError,
): PassportIdentityControllerErrorCode {
  if (error.code === "homeserver_signup_invitation_failed") return error.cause;
  if (error.code === "wrapping_key_failed") return wrappingKeyFailureCode(error.cause);
  return error.code;
}

function wrappingKeyFailureCode(
  code: Extract<GoogleBackedIdentityError, { code: "wrapping_key_failed" }>["cause"],
): PassportIdentityControllerErrorCode {
  switch (code) {
    case "invalid_google_id_token":
      return "invalid_google_id_token";
    case "rate_limited":
      return "wrapping_key_rate_limited";
    case "dependency_unavailable":
    case "internal_error":
    case "network_failed":
      return "wrapping_key_unavailable";
    case "invalid_request":
    case "invalid_response":
      return "wrapping_key_failed";
  }
}

function errorForAuthorizationCodeFailure(
  code: GoogleAuthorizationCodeErrorCode,
): GoogleBackedIdentityActionErrorCode {
  switch (code) {
    case "google_authorization_popup_closed":
      return "google_drive_authorization_popup_closed";
    case "google_authorization_popup_failed_to_open":
      return "google_drive_authorization_popup_failed_to_open";
    default:
      return "google_drive_authorization_failed";
  }
}
