import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../libs/logger/logger";
import type {
  GoogleBackedIdentityAction,
  GoogleBackedIdentityActionDispatchResult,
  GoogleBackedIdentityActionResult,
  GoogleBackedIdentityActionState,
  GoogleBackedIdentityActionValue,
  BrowserIdentityCatalogResult,
  BrowserIdentityController,
  BrowserIdentityControllerError,
  BrowserIdentityControllerErrorCode,
  BrowserIdentityList,
} from "./browserIdentityController";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityCredentials,
  GoogleBackedIdentityError,
  GoogleBackedIdentityResult,
  GoogleDrivePassportFileDeletionError,
  GoogleDrivePassportFileDeletionResult,
} from "./google-backed-identity/googleBackedIdentity";
import type {
  GoogleDriveAccessErrorCode,
  GoogleDriveAccessResult,
} from "../google-drive-access/googleDriveAccess";
import type {
  GoogleSignInCredential,
  GoogleSignInResult,
} from "../google-sign-in/googleIdentityServicesSignInButton";
import type {
  LocalIdentityResult,
  LocalIdentitySummary,
} from "./local-identity/localIdentity";

export type BrowserIdentityControllerDependencies = {
  list(): LocalIdentityResult<{ activeIdentityId: string | null; identities: LocalIdentitySummary[] }>;
  select(id: string): LocalIdentityResult<void>;
  clear(): LocalIdentityResult<void>;
  subscribe(listener: () => void): () => void;
  establishGoogleBackedIdentity(
    credentials: GoogleBackedIdentityCredentials,
  ): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>>;
  deleteGoogleDrivePassportFile(
    credentials: GoogleBackedIdentityCredentials,
    expectedPublicKeyZ32: string,
  ): Promise<GoogleDrivePassportFileDeletionResult>;
  disposeGoogleBackedIdentityOperations(): void;
  mountGoogleSignIn(
    target: HTMLElement,
    onCredential: (result: GoogleSignInResult<GoogleSignInCredential>) => void,
  ): Promise<GoogleSignInResult<void>>;
  unmountGoogleSignIn(): void;
  requestGoogleDriveAccess(
    googleSubject: string,
    signal: AbortSignal,
  ): Promise<GoogleDriveAccessResult<string>>;
};

export class PassportIdentityController implements BrowserIdentityController {
  readonly #dependencies: BrowserIdentityControllerDependencies;
  #target: HTMLElement | null = null;
  #onState: ((state: GoogleBackedIdentityActionState) => void) | null = null;
  #googleIdToken: string | null = null;
  #googleSubject: string | null = null;
  #driveAbortController: AbortController | null = null;
  #attempt = 0;
  #actionPending = false;
  #disposed = false;
  #googleBackedIdentityOperationsDisposed = false;

  constructor(input: { dependencies: BrowserIdentityControllerDependencies }) {
    this.#dependencies = input.dependencies;
  }

  list(): BrowserIdentityCatalogResult<BrowserIdentityList> {
    return this.runCatalogOperation("list", () => this.#dependencies.list());
  }

  select(id: string): BrowserIdentityCatalogResult<void> {
    return this.runCatalogOperation("select", () => this.#dependencies.select(id));
  }

  clear(): BrowserIdentityCatalogResult<void> {
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

  async mountGoogleSignIn(target: HTMLElement, onState: (state: GoogleBackedIdentityActionState) => void): Promise<void> {
    this.unmountGoogleSignIn();
    if (this.#disposed) return;
    this.#target = target;
    this.#onState = onState;
    const activeAttempt = ++this.#attempt;
    let mounted: Awaited<ReturnType<BrowserIdentityControllerDependencies["mountGoogleSignIn"]>>;
    try {
      mounted = await this.#dependencies.mountGoogleSignIn(
        target,
        (credential) => {
          if (this.#disposed || activeAttempt !== this.#attempt) return;
          if (Result.isError(credential)) {
            this.resetGoogle("sign_in_failed");
            return;
          }
          this.#googleIdToken = credential.value.googleIdToken;
          this.#googleSubject = credential.value.subject;
          this.emit({ stage: "google-drive-authorization", errorCode: null });
        },
      );
    } catch {
      if (activeAttempt === this.#attempt) {
        LOGGER.warn("identity.google.button.failed", {
          operation: "mount_google_sign_in",
          stage: "controller_dependency",
          code: "runtime_exception",
        });
        this.showGoogleUnavailable();
      }
      return;
    }
    if (this.#disposed || activeAttempt !== this.#attempt) return;
    if (Result.isError(mounted)) {
      this.showGoogleUnavailable();
      return;
    }
    if (!this.#googleIdToken) this.emit({ stage: "google-sign-in", errorCode: null });
  }

  unmountGoogleSignIn(): void {
    this.abortDriveAccess();
    try {
      this.releaseGoogleSignIn();
    } finally {
      this.#target = null;
      this.#onState = null;
      this.#googleIdToken = null;
      this.#googleSubject = null;
      this.#attempt += 1;
    }
  }

  retryGoogleSignIn(): void {
    const target = this.#target;
    const onState = this.#onState;
    if (!target || !onState || this.#disposed || this.#actionPending) return;
    void this.mountGoogleSignIn(target, onState);
  }

  async continueGoogleBackedIdentityAction(
    action: GoogleBackedIdentityAction,
  ): Promise<GoogleBackedIdentityActionDispatchResult> {
    if (this.#actionPending) return { status: "busy" };
    const googleIdToken = this.#googleIdToken;
    const googleSubject = this.#googleSubject;
    const activeAttempt = this.#attempt;
    if (this.#disposed) return { status: "superseded" };
    if (!googleIdToken || !googleSubject) {
      LOGGER.warn("identity.google.authorization.failed", {
        stage: "credential_validation",
        code: "missing_credentials",
      });
      this.resetGoogle("sign_in_failed");
      return { status: "google_authorization_failed" };
    }

    this.#actionPending = true;
    try {
      this.emit({ stage: "requesting-google-drive-authorization", errorCode: null });
      const abortController = new AbortController();
      this.abortDriveAccess();
      this.#driveAbortController = abortController;
      let driveAccess: GoogleDriveAccessResult<string>;
      try {
        driveAccess = await this.#dependencies.requestGoogleDriveAccess(
          googleSubject,
          abortController.signal,
        );
      } catch {
        if (activeAttempt !== this.#attempt || this.#disposed) return { status: "superseded" };
        LOGGER.warn("identity.google.button.drive_authorization_failed", { code: "unexpected" });
        this.resetGoogle("google_drive_authorization_failed");
        return { status: "google_authorization_failed" };
      }
      if (this.#driveAbortController === abortController) this.#driveAbortController = null;
      if (activeAttempt !== this.#attempt || this.#disposed) return { status: "superseded" };
      if (Result.isError(driveAccess)) {
        this.resetGoogle(errorForDriveFailure(driveAccess.error.code));
        return { status: "google_authorization_failed" };
      }

      this.#googleIdToken = null;
      this.#googleSubject = null;
      const result = await this.executeAction(action, { googleIdToken, driveAccessToken: driveAccess.value });
      if (this.#disposed || activeAttempt !== this.#attempt) {
        return { status: "action_finished_after_unmount", result };
      }
      this.resetGoogle();
      return { status: "action_completed", result };
    } finally {
      this.#actionPending = false;
      if (this.#disposed) this.disposeGoogleBackedIdentityOperationsOnce();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.unmountGoogleSignIn();
    } finally {
      if (!this.#actionPending) this.disposeGoogleBackedIdentityOperationsOnce();
    }
  }

  private async executeAction(action: GoogleBackedIdentityAction, credentials: GoogleBackedIdentityCredentials): Promise<GoogleBackedIdentityActionResult> {
    try {
      if (action.kind === "delete_google_drive_passport_file") {
        this.emit({ stage: "executing-action", errorCode: null });
        const deleted = await this.#dependencies.deleteGoogleDrivePassportFile(credentials, action.expectedPublicKeyZ32);
        return Result.isError(deleted) ? deletionFailure(deleted.error) : Result.ok({ kind: "google_drive_passport_file_deleted" });
      }
      this.emit({ stage: "executing-action", errorCode: null });
      const established = await this.#dependencies.establishGoogleBackedIdentity(credentials);
      if (Result.isError(established)) return establishmentFailure(established.error);
      const value: GoogleBackedIdentityActionValue = {
        kind: "google_backed_identity_established",
        establishmentMode: established.value.establishmentMode,
        publicIdentity: established.value.publicIdentity,
      };
      return Result.ok(value);
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

  private resetGoogle(errorCode: GoogleBackedIdentityActionState["errorCode"] = null): void {
    this.abortDriveAccess();
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.emit({ stage: "google-sign-in", errorCode });
  }

  private abortDriveAccess(): void {
    try { this.#driveAbortController?.abort(); }
    catch { LOGGER.warn("identity.google.cleanup.failed", { operation: "drive_abort" }); }
    this.#driveAbortController = null;
  }

  private showGoogleUnavailable(): void {
    this.releaseGoogleSignIn();
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.emit({ stage: "google-sign-in", errorCode: "sign_in_unavailable" });
  }

  private releaseGoogleSignIn(): void {
    try {
      this.#dependencies.unmountGoogleSignIn();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "google_sign_in_unmount",
        code: "cleanup_failed",
      });
    }
  }

  private runCatalogOperation<T>(
    operation: "list" | "select" | "clear",
    execute: () => LocalIdentityResult<T>,
  ): BrowserIdentityCatalogResult<T> {
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
): BrowserIdentityCatalogResult<T> {
  return Result.isError(result)
    ? Result.err({ code: result.error.code })
    : Result.ok(result.value);
}

function actionFailure(error: BrowserIdentityControllerError): GoogleBackedIdentityActionResult {
  return Result.err({
    code: error.code,
    ...(error.partialSetupPublicIdentity
      ? { partialSetupPublicIdentity: error.partialSetupPublicIdentity }
      : {}),
  });
}

function establishmentFailure(error: GoogleBackedIdentityError): GoogleBackedIdentityActionResult {
  return actionFailure({
    code: error.code === "homeserver_signup_invitation_failed"
      ? error.cause
      : error.code === "wrapping_key_failed"
        ? wrappingKeyFailureCode(error.cause)
        : error.code,
    ...(error.partialSetupPublicIdentity
      ? { partialSetupPublicIdentity: error.partialSetupPublicIdentity }
      : {}),
  });
}

function deletionFailure(error: GoogleDrivePassportFileDeletionError): GoogleBackedIdentityActionResult {
  return actionFailure({
    code: error.code === "wrapping_key_failed"
      ? wrappingKeyFailureCode(error.cause)
      : error.code,
  });
}

function wrappingKeyFailureCode(
  code: Extract<GoogleBackedIdentityError, { code: "wrapping_key_failed" }>["cause"],
): BrowserIdentityControllerErrorCode {
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

function errorForDriveFailure(code: GoogleDriveAccessErrorCode): GoogleBackedIdentityActionState["errorCode"] {
  switch (code) {
    case "google_drive_authorization_popup_closed": return "google_drive_authorization_popup_closed";
    case "google_drive_authorization_popup_failed_to_open": return "google_drive_authorization_popup_failed_to_open";
    case "google_drive_authorization_timeout": return "google_drive_authorization_timeout";
    case "google_drive_authorization_account_mismatch": return "google_drive_authorization_account_mismatch";
    case "google_drive_authorization_account_verification_failed": return "google_drive_authorization_account_verification_failed";
    default: return "google_drive_authorization_failed";
  }
}
