import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { logger } from "../../libs/logger/logger";
import type { PubkyIdentityKeys } from "../pubky/ports";
import type {
  BrowserIdentityAction,
  BrowserIdentityActionResult,
  BrowserIdentityActionValue,
  BrowserIdentityController,
  GoogleContinueResult,
  GoogleSignInState,
} from "./browserIdentityController";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityDeletion,
  GoogleBackedIdentityFlowError,
  GoogleIdentityProviderErrorCode,
  GoogleIdentityProviderResult,
  GoogleSignInWidget,
} from "./google/ports";
import type { LocalIdentityRepository } from "./localIdentityService";

type IdentityFlow = {
  establish(google: { googleIdToken: string; driveAccessToken: string }): Promise<ResultType<GoogleBackedIdentity, GoogleBackedIdentityFlowError>>;
};

export type BrowserIdentityControllerDependencies = {
  repository: LocalIdentityRepository;
  identityFlow: IdentityFlow;
  identityDeletion: GoogleBackedIdentityDeletion;
  identityKeys: Pick<PubkyIdentityKeys, "disposeIdentityKey">;
  disposePubky(): void;
  googleSignInWidget: GoogleSignInWidget;
  requestGoogleDriveAccess(input: {
    clientId: string;
    loginHint: string;
    expectedSubject: string;
    signal: AbortSignal;
  }): Promise<GoogleIdentityProviderResult<string>>;
};

export class DefaultBrowserIdentityController implements BrowserIdentityController {
  readonly #clientId: string;
  readonly #dependencies: BrowserIdentityControllerDependencies;
  #target: HTMLElement | null = null;
  #onState: ((state: GoogleSignInState) => void) | null = null;
  #googleIdToken: string | null = null;
  #googleSubject: string | null = null;
  #driveAbortController: AbortController | null = null;
  #attempt = 0;
  #actionPending = false;
  #disposed = false;
  #pubkyDisposed = false;

  constructor(input: { clientId: string; dependencies: BrowserIdentityControllerDependencies }) {
    this.#clientId = input.clientId;
    this.#dependencies = input.dependencies;
  }

  list() { return this.#dependencies.repository.list(); }
  select(id: string) { return this.#dependencies.repository.select(id); }
  clear() { return this.#dependencies.repository.clear(); }

  async mountGoogleSignIn(target: HTMLElement, onState: (state: GoogleSignInState) => void): Promise<void> {
    this.unmountGoogleSignIn();
    if (this.#disposed) return;
    this.#target = target;
    this.#onState = onState;
    const activeAttempt = ++this.#attempt;
    let mounted: Awaited<ReturnType<GoogleSignInWidget["mount"]>>;
    try {
      mounted = await this.#dependencies.googleSignInWidget.mount({
        target,
        onCredential: (credential) => {
          if (this.#disposed || activeAttempt !== this.#attempt) return;
          if (Result.isError(credential)) {
            logger.warn("identity.google.button.credential_failed", { code: credential.error.code });
            this.resetGoogle("sign_in_failed");
            return;
          }
          this.#googleIdToken = credential.value.googleIdToken;
          this.#googleSubject = credential.value.subject;
          this.emit({ stage: "drive", errorCode: null });
        },
      });
    } catch {
      if (activeAttempt === this.#attempt) this.showGoogleUnavailable("mount_threw");
      return;
    }
    if (this.#disposed || activeAttempt !== this.#attempt) return;
    if (Result.isError(mounted)) {
      this.showGoogleUnavailable(mounted.error.code);
      return;
    }
    if (!this.#googleIdToken) this.emit({ stage: "sign-in", errorCode: null });
  }

  unmountGoogleSignIn(): void {
    this.abortDriveAccess();
    this.#dependencies.googleSignInWidget.unmount();
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

  async continueGoogle(action: BrowserIdentityAction): Promise<GoogleContinueResult> {
    if (this.#actionPending) return { status: "busy" };
    const googleIdToken = this.#googleIdToken;
    const googleSubject = this.#googleSubject;
    const activeAttempt = this.#attempt;
    if (this.#disposed) return { status: "superseded" };
    if (!googleIdToken || !googleSubject) {
      this.resetGoogle("sign_in_failed");
      return { status: "credential_failed" };
    }

    this.#actionPending = true;
    try {
      this.emit({ stage: "submitting", errorCode: null });
      const abortController = new AbortController();
      this.abortDriveAccess();
      this.#driveAbortController = abortController;
      let driveAccess: GoogleIdentityProviderResult<string>;
      try {
        driveAccess = await this.#dependencies.requestGoogleDriveAccess({
          clientId: this.#clientId,
          loginHint: googleSubject,
          expectedSubject: googleSubject,
          signal: abortController.signal,
        });
      } catch {
        if (activeAttempt !== this.#attempt || this.#disposed) return { status: "superseded" };
        logger.warn("identity.google.button.drive_consent_failed", { code: "unexpected" });
        this.resetGoogle("drive_consent_failed");
        return { status: "credential_failed" };
      }
      if (this.#driveAbortController === abortController) this.#driveAbortController = null;
      if (activeAttempt !== this.#attempt || this.#disposed) return { status: "superseded" };
      if (Result.isError(driveAccess)) {
        logger.warn("identity.google.button.drive_consent_failed", { code: driveAccess.error.code });
        this.resetGoogle(errorForDriveFailure(driveAccess.error.code));
        return { status: "credential_failed" };
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
      if (this.#disposed) this.disposePubkyOnce();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.unmountGoogleSignIn();
    if (!this.#actionPending) this.disposePubkyOnce();
  }

  private async executeAction(action: BrowserIdentityAction, google: { googleIdToken: string; driveAccessToken: string }): Promise<BrowserIdentityActionResult> {
    try {
      if (action.kind === "delete") {
        const deleted = await this.#dependencies.identityDeletion.execute(google, action.expectedPublicKeyZ32);
        return Result.isError(deleted) ? Result.err(deleted.error) : Result.ok({ kind: "deleted" });
      }
      const established = await this.#dependencies.identityFlow.establish(google);
      if (Result.isError(established)) return Result.err(established.error);
      const value: BrowserIdentityActionValue = {
        kind: "established",
        source: established.value.source,
        publicIdentity: established.value.publicIdentity,
      };
      try {
        this.#dependencies.identityKeys.disposeIdentityKey({ keyHandle: established.value.keyHandle });
      } catch {
        logger.warn("identity.google.cleanup.failed", { operation: "established_key_dispose" });
      }
      return Result.ok(value);
    } catch {
      logger.warn("identity.google.action.failed", { code: "unexpected_failure" });
      return Result.err({ code: "unexpected_failure" });
    }
  }

  private disposePubkyOnce(): void {
    if (this.#pubkyDisposed) return;
    this.#pubkyDisposed = true;
    try {
      this.#dependencies.disposePubky();
    } catch {
      logger.warn("identity.google.cleanup.failed", { operation: "pubky_dispose" });
    }
  }

  private resetGoogle(errorCode: GoogleSignInState["errorCode"] = null): void {
    this.abortDriveAccess();
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.emit({ stage: "sign-in", errorCode });
  }

  private abortDriveAccess(): void {
    try { this.#driveAbortController?.abort(); }
    catch { logger.warn("identity.google.cleanup.failed", { operation: "drive_abort" }); }
    this.#driveAbortController = null;
  }

  private showGoogleUnavailable(code: string): void {
    logger.warn("identity.google.button.unavailable", { code });
    this.#dependencies.googleSignInWidget.unmount();
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.emit({ stage: "sign-in", errorCode: "sign_in_unavailable" });
  }

  private emit(state: GoogleSignInState): void {
    if (this.#disposed) return;
    try { this.#onState?.(state); }
    catch { logger.warn("identity.google.state_listener.failed"); }
  }
}

function errorForDriveFailure(code: GoogleIdentityProviderErrorCode): GoogleSignInState["errorCode"] {
  switch (code) {
    case "drive_popup_closed": return "drive_popup_closed";
    case "drive_popup_failed_to_open": return "drive_popup_failed_to_open";
    case "drive_consent_timeout": return "drive_consent_timeout";
    case "drive_account_mismatch": return "drive_account_mismatch";
    case "drive_account_verification_failed": return "drive_account_verification_failed";
    default: return "drive_consent_failed";
  }
}
