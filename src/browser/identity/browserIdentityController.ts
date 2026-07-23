import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { LocalIdentitySummary } from "../../features/identity/localIdentity";
import type { PubkyPublicIdentity } from "../../features/identity/pubkyIdentity";
import { logger } from "../../libs/logger/logger";
import type { PubkyIdentityKeys } from "./applicationContracts";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityFlowError,
  GoogleBackedIdentityFlowErrorCode,
} from "./google/googleBackedIdentityFlow";
import type { DeleteGoogleBackedIdentityErrorCode } from "./google/deleteGoogleBackedIdentity";
import type {
  GoogleAccounts,
  GoogleCredentialResponse,
  GoogleIdentityProviderErrorCode,
  GoogleIdentityProviderResult,
} from "./google/applicationContracts";
import type { LocalIdentityRepository, LocalIdentityRepositoryErrorCode } from "./localIdentityService";

export type BrowserIdentityList = {
  activeIdentityId: string | null;
  identities: LocalIdentitySummary[];
};

export type BrowserIdentityControllerError = {
  code: GoogleBackedIdentityFlowErrorCode | DeleteGoogleBackedIdentityErrorCode;
  recoverablePublicIdentity?: PubkyPublicIdentity;
};

export type BrowserIdentityAction =
  | { kind: "establish" }
  | { kind: "delete"; expectedPublicKeyZ32: string };

export type BrowserIdentityActionValue =
  | { kind: "established"; source: "created" | "restored"; publicIdentity: PubkyPublicIdentity }
  | { kind: "deleted" };

export type BrowserIdentityActionResult = ResultType<BrowserIdentityActionValue, BrowserIdentityControllerError>;

export type GoogleSignInState = {
  stage: "sign-in" | "drive" | "submitting";
  error: string | null;
};

export type GoogleContinueResult =
  | { status: "credential_failed" }
  | { status: "action_completed"; result: BrowserIdentityActionResult };

export type BrowserIdentityController = {
  list(): ResultType<BrowserIdentityList, { code: LocalIdentityRepositoryErrorCode }>;
  select(id: string): ResultType<void, { code: LocalIdentityRepositoryErrorCode }>;
  clear(): ResultType<void, { code: LocalIdentityRepositoryErrorCode }>;
  mountGoogleSignIn(target: HTMLElement, onState: (state: GoogleSignInState) => void): Promise<void>;
  unmountGoogleSignIn(): void;
  retryGoogleSignIn(): void;
  continueGoogle(action: BrowserIdentityAction): Promise<GoogleContinueResult>;
  dispose(): void;
};

type IdentityFlow = {
  establish(google: { googleIdToken: string; driveAccessToken: string }): Promise<ResultType<GoogleBackedIdentity, GoogleBackedIdentityFlowError>>;
};

type IdentityDeletion = {
  execute(
    google: { googleIdToken: string; driveAccessToken: string },
    expectedPublicKeyZ32: string,
  ): Promise<ResultType<void, { code: DeleteGoogleBackedIdentityErrorCode }>>;
};

export type BrowserIdentityControllerDependencies = {
  repository: LocalIdentityRepository;
  identityFlow: IdentityFlow;
  identityDeletion: IdentityDeletion;
  identityKeys: Pick<PubkyIdentityKeys, "disposeIdentityKey">;
  disposePubky(): void;
  loadGoogleAccounts(): Promise<GoogleIdentityProviderResult<GoogleAccounts>>;
  bindGoogleCredentialCallback(input: {
    accounts: GoogleAccounts;
    clientId: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): GoogleIdentityProviderResult<void>;
  releaseGoogleCredentialCallback(callback: (response: GoogleCredentialResponse) => void): void;
  googleIdTokenSubject(token: string): string | undefined;
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
  #accounts: GoogleAccounts | null = null;
  #target: HTMLElement | null = null;
  #onState: ((state: GoogleSignInState) => void) | null = null;
  #credentialCallback: ((response: GoogleCredentialResponse) => void) | null = null;
  #googleIdToken: string | null = null;
  #googleSubject: string | null = null;
  #driveAbortController: AbortController | null = null;
  #attempt = 0;
  #disposed = false;

  constructor(input: { clientId: string; dependencies: BrowserIdentityControllerDependencies }) {
    this.#clientId = input.clientId;
    this.#dependencies = input.dependencies;
  }

  list(): ResultType<BrowserIdentityList, { code: LocalIdentityRepositoryErrorCode }> {
    return this.#dependencies.repository.list();
  }

  select(id: string): ResultType<void, { code: LocalIdentityRepositoryErrorCode }> {
    return this.#dependencies.repository.select(id);
  }

  clear(): ResultType<void, { code: LocalIdentityRepositoryErrorCode }> {
    return this.#dependencies.repository.clear();
  }

  async mountGoogleSignIn(target: HTMLElement, onState: (state: GoogleSignInState) => void): Promise<void> {
    this.unmountGoogleSignIn();
    if (this.#disposed) return;

    this.#target = target;
    this.#onState = onState;
    const activeAttempt = ++this.#attempt;
    let accounts: GoogleIdentityProviderResult<GoogleAccounts>;
    try {
      accounts = await this.#dependencies.loadGoogleAccounts();
    } catch {
      if (activeAttempt === this.#attempt) this.showGoogleUnavailable("load_threw");
      return;
    }
    if (this.#disposed || activeAttempt !== this.#attempt) return;
    if (Result.isError(accounts)) {
      logger.warn("identity.google.button.unavailable", { code: accounts.error.code });
      this.emit({ stage: "sign-in", error: "Google sign-in is unavailable. Try again." });
      return;
    }

    const callback = (response: GoogleCredentialResponse): void => {
      if (this.#disposed || activeAttempt !== this.#attempt) return;
      try {
        if (typeof response.credential !== "string" || response.credential.length === 0) {
          logger.warn("identity.google.button.credential_failed");
          this.resetGoogle("Google sign-in did not return an identity. Try again.");
          return;
        }

        const subject = this.#dependencies.googleIdTokenSubject(response.credential);
        if (!subject) {
          this.resetGoogle("Google sign-in did not return an identity. Try again.");
          return;
        }
        this.#googleIdToken = response.credential;
        this.#googleSubject = subject;
        this.emit({ stage: "drive", error: null });
      } catch {
        logger.warn("identity.google.button.credential_failed", { code: "unexpected" });
        this.resetGoogle("Google sign-in did not return an identity. Try again.");
      }
    };
    this.#accounts = accounts.value;
    this.#credentialCallback = callback;
    let bound: GoogleIdentityProviderResult<void>;
    try {
      bound = this.#dependencies.bindGoogleCredentialCallback({
        accounts: accounts.value,
        clientId: this.#clientId,
        callback,
      });
    } catch {
      this.showGoogleUnavailable("bind_threw");
      return;
    }
    if (Result.isError(bound)) {
      logger.warn("identity.google.button.initialize_failed", { code: bound.error.code });
      this.showGoogleUnavailable("bind_failed");
      return;
    }

    if (!this.renderGoogleButton()) {
      this.showGoogleUnavailable("render_failed");
      return;
    }
    this.emit({ stage: "sign-in", error: null });
  }

  unmountGoogleSignIn(): void {
    this.abortDriveAccess();
    this.releaseGoogleCredentialCallback();
    this.#accounts = null;
    this.#target = null;
    this.#onState = null;
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.#attempt += 1;
  }

  retryGoogleSignIn(): void {
    const target = this.#target;
    const onState = this.#onState;
    if (!target || !onState || this.#disposed) return;
    void this.mountGoogleSignIn(target, onState);
  }

  async continueGoogle(action: BrowserIdentityAction): Promise<GoogleContinueResult> {
    const googleIdToken = this.#googleIdToken;
    const googleSubject = this.#googleSubject;
    const activeAttempt = this.#attempt;
    if (!googleIdToken || !googleSubject || this.#disposed) {
      this.resetGoogle("Google sign-in did not return an identity. Try again.");
      return { status: "credential_failed" };
    }

    this.emit({ stage: "submitting", error: null });
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
      if (activeAttempt !== this.#attempt) return { status: "credential_failed" };
      logger.warn("identity.google.button.drive_consent_failed", { code: "unexpected" });
      this.resetGoogle("Google Drive permission was not granted. Try again.");
      return { status: "credential_failed" };
    }
    if (this.#driveAbortController === abortController) this.#driveAbortController = null;
    if (activeAttempt !== this.#attempt || this.#disposed) return { status: "credential_failed" };
    if (Result.isError(driveAccess)) {
      logger.warn("identity.google.button.drive_consent_failed", { code: driveAccess.error.code });
      this.resetGoogle(messageForDriveFailure(driveAccess.error.code));
      return { status: "credential_failed" };
    }

    this.#googleIdToken = null;
    this.#googleSubject = null;
    const result = await this.executeAction(action, { googleIdToken, driveAccessToken: driveAccess.value });
    if (activeAttempt === this.#attempt) this.resetGoogle();
    return { status: "action_completed", result };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.unmountGoogleSignIn();
    this.#disposed = true;
    this.#dependencies.disposePubky();
  }

  private async executeAction(
    action: BrowserIdentityAction,
    google: { googleIdToken: string; driveAccessToken: string },
  ): Promise<BrowserIdentityActionResult> {
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
      this.#dependencies.identityKeys.disposeIdentityKey({ keyHandle: established.value.keyHandle });
      return Result.ok(value);
    } catch {
      logger.warn("identity.google.action.failed", { code: "unexpected_failure" });
      return Result.err({ code: "unexpected_failure" });
    }
  }

  private resetGoogle(error: string | null = null): void {
    this.abortDriveAccess();
    this.#googleIdToken = null;
    this.#googleSubject = null;
    if (this.#accounts && this.#target && !this.renderGoogleButton()) {
      this.showGoogleUnavailable("render_failed");
    } else {
      this.emit({ stage: "sign-in", error });
    }
  }

  private abortDriveAccess(): void {
    try {
      this.#driveAbortController?.abort();
    } catch {
      logger.warn("identity.google.cleanup.failed", { operation: "drive_abort" });
    }
    this.#driveAbortController = null;
  }

  private renderGoogleButton(): boolean {
    if (!this.#accounts || !this.#target) return false;
    try {
      this.#target.replaceChildren();
      this.#accounts.id.renderButton(this.#target, { theme: "outline", size: "large", text: "continue_with" });
      return true;
    } catch {
      return false;
    }
  }

  private showGoogleUnavailable(code: string): void {
    logger.warn("identity.google.button.unavailable", { code });
    this.releaseGoogleCredentialCallback();
    this.#accounts = null;
    this.#googleIdToken = null;
    this.#googleSubject = null;
    this.emit({ stage: "sign-in", error: "Google sign-in is unavailable. Try again." });
  }

  private releaseGoogleCredentialCallback(): void {
    if (!this.#credentialCallback) return;
    try {
      this.#dependencies.releaseGoogleCredentialCallback(this.#credentialCallback);
    } catch {
      logger.warn("identity.google.cleanup.failed", { operation: "credential_release" });
    }
    this.#credentialCallback = null;
  }

  private emit(state: GoogleSignInState): void {
    try {
      this.#onState?.(state);
    } catch {
      logger.warn("identity.google.state_listener.failed");
    }
  }
}

function messageForDriveFailure(code: GoogleIdentityProviderErrorCode): string {
  switch (code) {
    case "drive_popup_closed":
      return "The Google Drive window was closed. Try again.";
    case "drive_popup_failed_to_open":
      return "The Google Drive window could not open. Check popup blocking and try again.";
    case "drive_consent_timeout":
      return "Google Drive permission timed out. Try again.";
    case "drive_account_mismatch":
      return "Choose the same Google account for sign-in and Drive, then try again.";
    case "drive_account_verification_failed":
      return "Google Drive account verification is unavailable. Check your connection and try again.";
    default:
      return "Google Drive permission was not granted. Try again.";
  }
}
