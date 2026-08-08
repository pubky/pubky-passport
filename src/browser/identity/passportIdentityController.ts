import "client-only";

import { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";
import type { GoogleAccountProfile } from "../../core/identity/googleAccountProfile";
import { LOGGER } from "../../libs/logger/logger";
import type {
  GoogleBackedIdentity,
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
import type { GoogleAuthorizationCodeResult } from "../google-authorization/googleAuthorizationCode";
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
  | "google_drive_authorization_timeout"
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
  clear(): LocalIdentityResult<void>;
  subscribe(listener: () => void): () => void;
  resolveHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult>;
  createBackup(identityId: string, password: string): Promise<LocalIdentityBackupResult>;
  createPubkyRingMigrationUrl(): LocalIdentityResult<string>;
  restoreOrCreateGoogleBackedIdentity(
    credentials: GoogleBackedIdentityCredentials,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>>;
  deleteGoogleIdentityBackups(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<GoogleIdentityBackupDeletionResult>;
  disposeGoogleBackedIdentityOperations(): void;
  prepareGoogleAuthorization(): Promise<GoogleAuthorizationCodeResult<void>>;
  requestGoogleAuthorization(): Promise<GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>>;
  disposeGoogleAuthorization(): void;
};

export class PassportIdentityController {
  readonly #dependencies: PassportIdentityControllerDependencies;
  #onState: ((state: GoogleBackedIdentityActionState) => void) | null = null;
  #mountGeneration = 0;
  #actionPending = false;
  #disposed = false;
  #googleBackedIdentityOperationsDisposed = false;

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

  clear(): PassportIdentityCatalogResult<void> {
    return this.runCatalogOperation("clear", () => this.#dependencies.clear());
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

  async prepareGoogleAuthorization(onState: (state: GoogleBackedIdentityActionState) => void): Promise<void> {
    this.disposeGoogleAuthorization();
    if (this.#disposed) return;
    this.#onState = onState;
    const activeGeneration = ++this.#mountGeneration;
    let prepared: GoogleAuthorizationCodeResult<void>;
    try {
      prepared = await this.#dependencies.prepareGoogleAuthorization();
    } catch {
      if (activeGeneration === this.#mountGeneration) this.showGoogleUnavailable();
      return;
    }
    if (this.#disposed || activeGeneration !== this.#mountGeneration) return;
    if (Result.isError(prepared)) this.showGoogleUnavailable();
    else this.emit({ stage: "google-authorization", errorCode: null });
  }

  disposeGoogleAuthorization(): void {
    try {
      this.#dependencies.disposeGoogleAuthorization();
    } finally {
      this.#onState = null;
      this.#mountGeneration += 1;
    }
  }

  retryGoogleAuthorization(): void {
    const onState = this.#onState;
    if (!onState || this.#disposed || this.#actionPending) return;
    void this.prepareGoogleAuthorization(onState);
  }

  async continueGoogleBackedIdentityAction(
    action: GoogleBackedIdentityAction,
  ): Promise<GoogleBackedIdentityActionDispatchResult> {
    if (this.#actionPending) return { status: "busy" };
    if (this.#disposed) return { status: "superseded" };
    const activeGeneration = this.#mountGeneration;
    this.#actionPending = true;
    try {
      this.emit({ stage: "requesting-google-authorization" });
      const credentials = await this.#dependencies.requestGoogleAuthorization();
      if (this.#disposed || activeGeneration !== this.#mountGeneration) return { status: "superseded" };
      if (Result.isError(credentials)) {
        this.resetGoogleAuthorization(errorForAuthorizationCodeFailure(credentials.error.code));
        return { status: "google_authorization_failed" };
      }
      if (action.kind !== "establish_google_backed_identity"
        && credentials.value.googleAccount.id !== action.expectedGoogleAccountId) {
        this.resetGoogleAuthorization("google_drive_authorization_account_mismatch");
        return { status: "google_authorization_failed" };
      }
      const result = await this.executeAction(action, credentials.value, activeGeneration);
      if (this.#disposed || activeGeneration !== this.#mountGeneration) return { status: "action_finished_after_unmount", result };
      this.resetGoogleAuthorization();
      return { status: "action_completed", result };
    } catch {
      this.resetGoogleAuthorization("google_drive_authorization_failed");
      return { status: "google_authorization_failed" };
    } finally {
      this.#actionPending = false;
      if (this.#disposed) this.disposeGoogleBackedIdentityOperationsOnce();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.disposeGoogleAuthorization();
    } finally {
      if (!this.#actionPending) this.disposeGoogleBackedIdentityOperationsOnce();
    }
  }

  private async executeAction(
    action: GoogleBackedIdentityAction,
    credentials: GoogleBackedIdentityCredentials,
    activeGeneration: number,
  ): Promise<GoogleBackedIdentityActionResult> {
    try {
      switch (action.kind) {
        case "detach_google_backed_identity": {
          this.emit({ stage: "detaching-google-backed-identity" });
          const deleted = await this.#dependencies.deleteGoogleIdentityBackups(
            credentials,
            action.publicIdentity,
            action.expectedGoogleAccountId,
          );
          if (Result.isError(deleted)) return deletionFailure(deleted.error);
          const removed = this.#dependencies.remove(action.publicIdentity.publicKeyZ32);
          return Result.isError(removed)
            ? actionFailure({ code: "local_remove_failed" })
            : Result.ok({ kind: "google_backed_identity_detached", deletionStatus: deleted.value.status });
        }
        case "replace_incomplete_google_backed_identity": {
          this.emit({ stage: "establishing-google-backed-identity", progress: "checking_passport_file" });
          const deleted = await this.#dependencies.deleteGoogleIdentityBackups(
            credentials,
            action.publicIdentity,
            action.expectedGoogleAccountId,
          );
          if (Result.isError(deleted)) return deletionFailure(deleted.error);
          break;
        }
        case "establish_google_backed_identity":
          break;
      }
      let progressActive = true;
      const reportProgress: ReportGoogleBackedIdentityProgress = (progress) => {
        if (!progressActive || this.#disposed || activeGeneration !== this.#mountGeneration) return;
        this.emit({ stage: "establishing-google-backed-identity", progress });
      };
      let restoredOrCreated: GoogleBackedIdentityResult<GoogleBackedIdentity>;
      try {
        restoredOrCreated = await this.#dependencies.restoreOrCreateGoogleBackedIdentity(
          credentials,
          reportProgress,
        );
      } finally {
        progressActive = false;
      }
      if (Result.isError(restoredOrCreated)) {
        return establishmentFailure(restoredOrCreated.error, credentials.googleAccount);
      }
      return restoredOrCreated.value.establishmentMode === "created"
        ? Result.ok({
          kind: "google_backed_identity_established",
          establishmentMode: "created",
          publicIdentity: restoredOrCreated.value.publicIdentity,
          visibleRecoveryCopyStatus: restoredOrCreated.value.visibleRecoveryCopyStatus,
        })
        : Result.ok({
          kind: "google_backed_identity_established",
          establishmentMode: "restored",
          publicIdentity: restoredOrCreated.value.publicIdentity,
        });
    } catch {
      LOGGER.warn("identity.google.action.failed", { code: "unexpected_failure" });
      return Result.err({ code: "unexpected_failure" });
    }
  }

  private disposeGoogleBackedIdentityOperationsOnce(): void {
    if (this.#googleBackedIdentityOperationsDisposed) return;
    this.#googleBackedIdentityOperationsDisposed = true;
    try {
      this.#dependencies.disposeGoogleBackedIdentityOperations();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", { operation: "pubky_dispose" });
    }
  }

  private resetGoogleAuthorization(errorCode: GoogleBackedIdentityActionErrorCode | null = null): void {
    this.emit({ stage: "google-authorization", errorCode });
  }

  private showGoogleUnavailable(): void {
    this.emit({ stage: "google-authorization", errorCode: "google_authorization_unavailable" });
  }

  private runCatalogOperation<T>(
    operation: "list" | "select" | "remove" | "clear" | "create_pubky_ring_migration",
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
    try { this.#onState?.(state); }
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

function actionFailure(error: PassportIdentityControllerError): GoogleBackedIdentityActionResult {
  return Result.err(error);
}

function establishmentFailure(
  error: GoogleBackedIdentityError,
  googleAccount: GoogleAccountProfile,
): GoogleBackedIdentityActionResult {
  return actionFailure({
    code: error.code === "homeserver_signup_invitation_failed"
      ? error.cause
      : error.code === "wrapping_key_failed"
        ? wrappingKeyFailureCode(error.cause)
        : error.code,
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
  return actionFailure({
    code: error.code === "wrapping_key_failed"
      ? wrappingKeyFailureCode(error.cause)
      : error.code,
  });
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

function errorForAuthorizationCodeFailure(code: import("../google-authorization/googleAuthorizationCode").GoogleAuthorizationCodeErrorCode): GoogleBackedIdentityActionErrorCode {
  switch (code) {
    case "google_authorization_popup_closed": return "google_drive_authorization_popup_closed";
    case "google_authorization_popup_failed_to_open": return "google_drive_authorization_popup_failed_to_open";
    case "google_authorization_timeout": return "google_drive_authorization_timeout";
    default: return "google_drive_authorization_failed";
  }
}
