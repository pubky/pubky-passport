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
} from "./browserIdentityController";
import type { GoogleBackedIdentityCredentials, GoogleBackedIdentityError, GoogleBackedIdentityResult, GoogleBackedIdentity, GoogleDrivePassportFileDeletionResult } from "./google-backed-identity/application/googleBackedIdentity";
import type {
  GoogleDriveAccessErrorCode,
  GoogleDriveAccessResult,
} from "./google-drive-access/application/googleDriveAccess";
import type {
  GoogleSignInCredential,
  GoogleSignInResult,
} from "./google-sign-in/application/googleSignIn";
import type {
  LocalIdentityResult,
  LocalIdentitySummary,
} from "./local-identity/application/localIdentityModels";

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

  list() { return toCatalogResult(this.#dependencies.list()); }
  select(id: string) { return toCatalogResult(this.#dependencies.select(id)); }
  clear() { return toCatalogResult(this.#dependencies.clear()); }
  subscribe(listener: () => void) { return this.#dependencies.subscribe(listener); }

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
            LOGGER.warn("identity.google.button.credential_failed", { code: credential.error.code });
            this.resetGoogle("sign_in_failed");
            return;
          }
          this.#googleIdToken = credential.value.googleIdToken;
          this.#googleSubject = credential.value.subject;
          this.emit({ stage: "google-drive-authorization", errorCode: null });
        },
      );
    } catch {
      if (activeAttempt === this.#attempt) this.showGoogleUnavailable("mount_threw");
      return;
    }
    if (this.#disposed || activeAttempt !== this.#attempt) return;
    if (Result.isError(mounted)) {
      this.showGoogleUnavailable(mounted.error.code);
      return;
    }
    if (!this.#googleIdToken) this.emit({ stage: "google-sign-in", errorCode: null });
  }

  unmountGoogleSignIn(): void {
    this.abortDriveAccess();
    this.#dependencies.unmountGoogleSignIn();
    this.#target = null;
    this.#onState = null;
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.#attempt += 1;
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
        LOGGER.warn("identity.google.button.drive_authorization_failed", { code: driveAccess.error.code });
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
    this.unmountGoogleSignIn();
    if (!this.#actionPending) this.disposeGoogleBackedIdentityOperationsOnce();
  }

  private async executeAction(action: GoogleBackedIdentityAction, credentials: GoogleBackedIdentityCredentials): Promise<GoogleBackedIdentityActionResult> {
    try {
      if (action.kind === "delete_google_drive_passport_file") {
        this.emit({ stage: "executing-action", errorCode: null });
        const deleted = await this.#dependencies.deleteGoogleDrivePassportFile(credentials, action.expectedPublicKeyZ32);
        return Result.isError(deleted) ? actionFailure(deleted.error) : Result.ok({ kind: "google_drive_passport_file_deleted" });
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

  private showGoogleUnavailable(code: string): void {
    LOGGER.warn("identity.google.button.unavailable", { code });
    this.#dependencies.unmountGoogleSignIn();
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.emit({ stage: "google-sign-in", errorCode: "sign_in_unavailable" });
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
    code: error.code === "homeserver_signup_invitation_failed" ? error.cause : error.code,
    ...(error.partialSetupPublicIdentity
      ? { partialSetupPublicIdentity: error.partialSetupPublicIdentity }
      : {}),
  });
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
