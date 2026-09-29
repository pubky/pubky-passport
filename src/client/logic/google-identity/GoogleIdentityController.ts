import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { AuthorizationPopup } from "./gia/AuthorizationPopup";
import type {
  GoogleImplicitAuthorization,
  GoogleIdentityCredentials,
} from "./gia/GoogleImplicitAuthorization";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import {
  withoutCause,
  type GoogleIdentityError,
  type GoogleIdentityViewError,
} from "./googleIdentityErrors";
import type {
  GoogleIdentityLifecycle,
  GoogleIdentityProgress,
  GoogleIdentityBackup,
  VisibleRecoveryCopyStatus,
} from "./GoogleIdentityLifecycle";

export type {
  GoogleIdentityBackup,
  GoogleIdentityProgress,
  VisibleRecoveryCopyStatus,
} from "./GoogleIdentityLifecycle";

/** Safe setup or restore details published after the identity is active locally. */
type EstablishedGoogleIdentity =
  | {
      establishmentMode: "created";
      googleAccount: GoogleAccountProfile;
      publicIdentity: PubkyPublicIdentity;
      visibleRecoveryCopyStatus: VisibleRecoveryCopyStatus;
    }
  | {
      establishmentMode: "restored";
      googleAccount: GoogleAccountProfile;
      publicIdentity: PubkyPublicIdentity;
    };

/**
 * Render-safe states published while Passport creates, restores, attaches (backs up), or detaches
 * a Google-backed identity.
 */
export type GoogleIdentityViewState =
  | { status: "idle" }
  | { status: "requesting-authorization" }
  | { status: "establishing"; progress: GoogleIdentityProgress }
  | { status: "established"; identity: EstablishedGoogleIdentity }
  | { status: "detaching" }
  | { status: "detached" }
  | { status: "backing-up" }
  | { status: "backed-up"; backup: GoogleIdentityBackup }
  | { status: "failed"; error: GoogleIdentityViewError };

export type EstablishGoogleIdentityResult = ResultType<
  EstablishedGoogleIdentity,
  GoogleIdentityViewError
>;

export type DetachGoogleIdentityResult = ResultType<void, GoogleIdentityViewError>;

export type BackupGoogleIdentityResult = ResultType<GoogleIdentityBackup, GoogleIdentityViewError>;

type GoogleAuthorization = Pick<GoogleImplicitAuthorization, "request" | "cancel" | "dispose">;
/** Google's window while an operation waits for the person there, and whether they cancelled. */
type PendingAuthorization = { popup: AuthorizationPopup; cancelled: boolean };
type Lifecycle = Pick<
  GoogleIdentityLifecycle,
  | "establishIdentity"
  | "replaceInvalidPassportFile"
  | "replaceUndecryptablePassportFile"
  | "detachIdentity"
  | "backupIdentity"
  | "abortRequests"
  | "dispose"
>;
type EstablishmentOperation =
  "establish" | "replace_invalid_passport_file" | "replace_undecryptable_passport_file";
type EstablishmentOptions = {
  allowWithoutVisibleBackup?: boolean;
  credentials?: GoogleIdentityCredentials | undefined;
};
type GoogleIdentityOperation = EstablishmentOperation | "detach" | "backup";
type OperationWork<Success> = (
  credentials: GoogleIdentityCredentials,
  lifecycle: Lifecycle,
) => Promise<ResultType<Success, GoogleIdentityError>>;
/** Credentials kept from a paused operation, with the state published when they are reused. */
type ReusedCredentials = {
  credentials: GoogleIdentityCredentials;
  workingState: GoogleIdentityViewState;
};
/** An operation paused on the optional visible-copy permission, with the grant it received. */
type PendingVisibleBackupConsent =
  | { operation: EstablishmentOperation; credentials: GoogleIdentityCredentials }
  | {
      operation: "backup";
      credentials: GoogleIdentityCredentials;
      publicIdentity: PubkyPublicIdentity;
    };

/**
 * ready → busy (runOperation) → ready (finishOperation).
 * dispose(): ready → disposed (lifecycle released immediately); busy → disposing (lifecycle
 * released by finishOperation once the in-flight operation settles). disposed is terminal.
 */
type ControllerStatus = "ready" | "busy" | "disposing" | "disposed";

const IDLE_STATE: GoogleIdentityViewState = { status: "idle" };
const CREDENTIAL_EXPIRY_MARGIN_MS = 30_000;

/**
 * Presentation-facing controller for one screen's Google authorization and identity flow.
 *
 * New operations obtain fresh short-lived Google credentials; continuing paused setup
 * can reuse unexpired credentials. Credentials stay in this browser object and go directly to the
 * Google-backed operation, and never enter UI state. Only one operation may run at
 * a time. Calling {@link dispose} cancels authorization and suppresses later UI
 * updates while allowing already-started cleanup to finish safely.
 *
 * Operations that need new credentials open the Google consent popup synchronously, before
 * their first await, so call them directly from the user's click handler or the browser
 * blocks the popup.
 *
 * State is published through {@link subscribe}; public asynchronous operations also
 * settle with a Result and do not intentionally reject.
 *
 * Each optional constructor factory independently replaces the lazy-imported
 * authorization or lifecycle constructor. Production omits both.
 */
export class GoogleIdentityController {
  private googleAuthorization: GoogleAuthorization | undefined;
  private lifecycle: Lifecycle | undefined;
  private googleSubject: string | undefined;
  private pendingVisibleBackupConsent: PendingVisibleBackupConsent | undefined;
  private pendingAuthorization: PendingAuthorization | undefined;
  private status: ControllerStatus = "ready";
  private state: GoogleIdentityViewState = IDLE_STATE;
  private readonly listeners = new Set<(state: GoogleIdentityViewState) => void>();

  /**
   * @param googleClientId OAuth client ID used by the Google authorization popup.
   * @param homegateBaseUrl Trusted Homegate endpoint used to obtain homeserver signup tokens.
   */
  constructor(
    private readonly googleClientId: string,
    private readonly homegateBaseUrl: string,
    private readonly createAuthorization?: (googleClientId: string) => GoogleAuthorization,
    private readonly createLifecycle?: (
      homegateBaseUrl: string,
      passportOrigin: string,
    ) => Lifecycle,
  ) {}

  getState(): GoogleIdentityViewState {
    return this.state;
  }

  /**
   * Subscribes to state transitions. Listener exceptions are contained so they
   * cannot interrupt an identity operation.
   */
  subscribe(listener: (state: GoogleIdentityViewState) => void): () => void {
    if (this.isDisposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Restores or creates and activates an identity.
   * The promise settles with a Result and does not intentionally reject.
   */
  async establishIdentity(): Promise<EstablishGoogleIdentityResult> {
    return this.runIdentityEstablishment("establish");
  }

  /**
   * Permanently removes a malformed Drive file and immediately creates a replacement identity.
   * The promise settles with a Result and does not intentionally reject.
   */
  async replaceInvalidPassportFile(): Promise<EstablishGoogleIdentityResult> {
    return this.runIdentityEstablishment("replace_invalid_passport_file");
  }

  /**
   * Permanently removes a Drive file that cannot be decrypted for this Google account and
   * immediately creates a replacement identity.
   * The promise settles with a Result and does not intentionally reject.
   */
  async replaceUndecryptablePassportFile(): Promise<EstablishGoogleIdentityResult> {
    return this.runIdentityEstablishment("replace_undecryptable_passport_file");
  }

  /**
   * Continues a paused establishment without a visible copy, renewing expired credentials for
   * the same Google account.
   * The promise settles with a Result and does not intentionally reject.
   */
  async continueWithoutVisibleBackup(): Promise<EstablishGoogleIdentityResult> {
    const pending = this.pendingVisibleBackupConsent;
    if (!pending || pending.operation === "backup") return Result.err({ code: "operation_failed" });
    return this.runIdentityEstablishment(pending.operation, {
      allowWithoutVisibleBackup: true,
      credentials: reusableCredentials(pending.credentials),
    });
  }

  /**
   * Deletes the Google Drive Passport files, keeping the identity active locally.
   * A Google Drive failure leaves the local identity untouched.
   * The promise settles with a Result and does not intentionally reject.
   */
  async detachIdentity(
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleSubject: string,
  ): Promise<DetachGoogleIdentityResult> {
    return this.runOperation(
      "detach",
      expectedGoogleSubject,
      (credentials, lifecycle) => {
        this.publish({ status: "detaching" });
        return lifecycle.detachIdentity(credentials, publicIdentity, expectedGoogleSubject);
      },
      () => ({ status: "detached" }),
    );
  }

  /**
   * Attaches an existing local identity to an empty Google account by backing up its key to
   * Google Drive. Opens the consent popup synchronously, so call it from the user's click.
   * The promise settles with a Result and does not intentionally reject.
   */
  async backupIdentity(publicIdentity: PubkyPublicIdentity): Promise<BackupGoogleIdentityResult> {
    return this.runBackup(publicIdentity, false);
  }

  /**
   * Continues a paused attachment without a visible copy, renewing expired credentials for the
   * same Google account.
   * The promise settles with a Result and does not intentionally reject.
   */
  async continueBackupWithoutVisibleCopy(): Promise<BackupGoogleIdentityResult> {
    const pending = this.pendingVisibleBackupConsent;
    if (pending?.operation !== "backup") return Result.err({ code: "operation_failed" });
    return this.runBackup(pending.publicIdentity, true, reusableCredentials(pending.credentials));
  }

  /**
   * Brings Google's window to the front while an operation waits for the person there, for when
   * it slipped behind Passport. Call it from a click; browsers may still refuse.
   */
  showAuthorizationWindow(): void {
    this.pendingAuthorization?.popup.focus();
  }

  /**
   * Stops an operation that is waiting for the person in Google's window: closes the window and
   * returns to idle, as {@link reset} does, instead of reporting a failure. The operation's
   * promise settles with `cancelled`. Does nothing once the authorization has settled, so work
   * that already holds credentials is never interrupted.
   */
  cancelAuthorization(): void {
    const pending = this.pendingAuthorization;
    if (!pending || pending.cancelled) return;
    pending.cancelled = true;
    pending.popup.close();
    try {
      this.googleAuthorization?.cancel();
    } catch (e) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "authorization_cancel",
        ...safeErrorLogFields(e),
      });
    }
  }

  /** Returns to idle and lets a new establishment flow choose a different Google account. */
  reset(): void {
    this.googleSubject = undefined;
    this.pendingVisibleBackupConsent = undefined;
    if (this.status === "ready") this.publish(IDLE_STATE);
  }

  /** Cancels Google authorization and releases Pubky SDK resources owned by this controller. */
  dispose(): void {
    if (this.isDisposed) return;
    const isOperationInFlight = this.status === "busy";
    this.status = isOperationInFlight ? "disposing" : "disposed";
    this.googleSubject = undefined;
    this.pendingVisibleBackupConsent = undefined;
    this.listeners.clear();
    try {
      this.googleAuthorization?.dispose();
    } catch (e) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "authorization_dispose",
        ...safeErrorLogFields(e),
      });
    } finally {
      this.lifecycle?.abortRequests();
      if (!isOperationInFlight) this.disposeLifecycle();
    }
  }

  private get isDisposed(): boolean {
    return this.status === "disposing" || this.status === "disposed";
  }

  private runIdentityEstablishment(
    operation: EstablishmentOperation,
    options: EstablishmentOptions = {},
  ): Promise<EstablishGoogleIdentityResult> {
    const allowWithoutVisibleBackup = options.allowWithoutVisibleBackup ?? false;
    return this.runOperation(
      operation,
      undefined,
      async (credentials, lifecycle) => {
        let reporting = true;
        const report = (progress: GoogleIdentityProgress) => {
          if (reporting) this.publish({ status: "establishing", progress });
        };
        const establishment = startEstablishment(
          lifecycle,
          operation,
          credentials,
          report,
          allowWithoutVisibleBackup,
        );
        const established = await establishment.finally(() => {
          reporting = false;
        });
        if (Result.isError(established)) {
          if (established.error.code === "visible_backup_permission_missing" && !this.isDisposed) {
            this.pendingVisibleBackupConsent = { credentials, operation };
          }
          return Result.err(established.error);
        }

        // Name every field so nothing new on the lifecycle result reaches UI state unreviewed.
        const googleAccount = credentials.googleAccount;
        switch (established.value.establishmentMode) {
          case "created":
            return Result.ok({
              establishmentMode: "created",
              googleAccount,
              publicIdentity: established.value.publicIdentity,
              visibleRecoveryCopyStatus: established.value.visibleRecoveryCopyStatus,
            });
          case "restored":
            return Result.ok({
              establishmentMode: "restored",
              googleAccount,
              publicIdentity: established.value.publicIdentity,
            });
        }
      },
      (identity) => ({ status: "established", identity }),
      options.credentials && {
        credentials: options.credentials,
        workingState: { status: "establishing", progress: { flow: "lookup", step: "checking" } },
      },
    );
  }

  private runBackup(
    publicIdentity: PubkyPublicIdentity,
    allowWithoutVisibleBackup: boolean,
    credentials?: GoogleIdentityCredentials,
  ): Promise<BackupGoogleIdentityResult> {
    return this.runOperation(
      "backup",
      undefined,
      async (authorized, lifecycle) => {
        this.publish({ status: "backing-up" });
        const result = await lifecycle.backupIdentity(
          authorized,
          publicIdentity,
          allowWithoutVisibleBackup,
        );
        if (
          Result.isError(result) &&
          result.error.code === "visible_backup_permission_missing" &&
          !this.isDisposed
        ) {
          this.pendingVisibleBackupConsent = {
            operation: "backup",
            credentials: authorized,
            publicIdentity,
          };
        }
        return result;
      },
      // Name every field so nothing new on the lifecycle result reaches UI state unreviewed.
      (backup) => ({
        status: "backed-up",
        backup: { visibleRecoveryCopyStatus: backup.visibleRecoveryCopyStatus },
      }),
      credentials && { credentials, workingState: { status: "backing-up" } },
    );
  }

  /**
   * Runs one authorized operation with a single entry and exit for the busy state,
   * publishing the terminal state unless the controller was disposed meanwhile. Reused
   * credentials skip authorization and publish the caller's working state instead.
   */
  private async runOperation<Success>(
    operation: GoogleIdentityOperation,
    expectedGoogleSubject: string | undefined,
    work: OperationWork<Success>,
    toState: (value: Success) => GoogleIdentityViewState,
    reused?: ReusedCredentials,
  ): Promise<ResultType<Success, GoogleIdentityViewError>> {
    if (this.status !== "ready") {
      return Result.err({ code: this.status === "busy" ? "operation_failed" : "cancelled" });
    }
    this.status = "busy";
    this.pendingVisibleBackupConsent = undefined;
    this.publish(reused ? reused.workingState : { status: "requesting-authorization" });

    try {
      const outcome = await this.authorizeAndRun(
        operation,
        expectedGoogleSubject,
        work,
        reused?.credentials,
      );
      return this.settle(outcome, toState);
    } catch (e) {
      LOGGER.warn("identity.google.action.failed", {
        operation,
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return this.settle(Result.err({ code: "operation_failed" }), toState);
    } finally {
      this.finishOperation();
    }
  }

  private async authorizeAndRun<Success>(
    operation: GoogleIdentityOperation,
    expectedGoogleSubject: string | undefined,
    work: OperationWork<Success>,
    credentialsOverride?: GoogleIdentityCredentials,
  ): Promise<ResultType<Success, GoogleIdentityError>> {
    const authorized = credentialsOverride
      ? Result.ok(credentialsOverride)
      : await this.requestGoogleCredentials(expectedGoogleSubject);
    if (Result.isError(authorized)) return Result.err(authorized.error);
    // Disposal may land between the authorization settling and this continuation.
    if (this.isDisposed) return Result.err({ code: "cancelled" });

    const lifecycle = this.lifecycle;
    if (!lifecycle) {
      LOGGER.warn("identity.google.action.failed", { operation, code: "lifecycle_unavailable" });
      return Result.err({ code: "operation_failed" });
    }

    const outcome = await work(authorized.value, lifecycle);
    if (Result.isError(outcome)) {
      LOGGER.warn("identity.google.action.failed", {
        operation,
        code: outcome.error.code,
        ...safeErrorLogFields(outcome.error),
      });
    }
    return outcome;
  }

  private settle<Success>(
    outcome: ResultType<Success, GoogleIdentityError>,
    toState: (value: Success) => GoogleIdentityViewState,
  ): ResultType<Success, GoogleIdentityViewError> {
    if (this.isDisposed) return Result.err({ code: "cancelled" });
    // Only cancelAuthorization() yields `cancelled` on a live controller: the person chose to
    // stop, so the screen starts over rather than reporting a failure.
    if (Result.isError(outcome) && outcome.error.code === "cancelled") {
      this.googleSubject = undefined;
      this.publish(IDLE_STATE);
      return Result.err({ code: "cancelled" });
    }
    if (Result.isError(outcome)) {
      const error = withoutCause(outcome.error);
      this.publish({ status: "failed", error });
      return Result.err(error);
    }
    this.publish(toState(outcome.value));
    return Result.ok(outcome.value);
  }

  private async requestGoogleCredentials(
    expectedGoogleSubject: string | undefined,
  ): Promise<ResultType<GoogleIdentityCredentials, GoogleIdentityError>> {
    // Opened before the first await so it still belongs to the user's click. Safari blocks a
    // popup opened after the lazy imports below on a cold page, then allows it on "Try again".
    const popup = AuthorizationPopup.openPending();
    if (!popup) {
      LOGGER.warn("identity.google.authorization.failed", {
        operation: "request_credentials",
        code: "google_authorization_popup_failed_to_open",
      });
      return Result.err({ code: "google_authorization_popup_failed_to_open" });
    }

    const pending: PendingAuthorization = { popup, cancelled: false };
    this.pendingAuthorization = pending;
    try {
      return await this.authorizeInPopup(pending, expectedGoogleSubject);
    } finally {
      this.pendingAuthorization = undefined;
    }
  }

  private async authorizeInPopup(
    pending: PendingAuthorization,
    expectedGoogleSubject: string | undefined,
  ): Promise<ResultType<GoogleIdentityCredentials, GoogleIdentityError>> {
    const popup = pending.popup;
    try {
      // A cancel during the lazy imports has already closed the window.
      if (!(await this.initializeDependencies()) || pending.cancelled) {
        popup.close();
        return Result.err({ code: "cancelled" });
      }
    } catch (e) {
      popup.close();
      LOGGER.error("identity.google.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "operation_failed", cause: e });
    }

    const googleAuthorization = this.googleAuthorization;
    if (!googleAuthorization) {
      popup.close();
      LOGGER.warn("identity.google.authorization.failed", {
        operation: "request_credentials",
        code: "authorization_unavailable",
      });
      return Result.err({ code: "operation_failed" });
    }

    const googleSubject = expectedGoogleSubject ?? this.googleSubject;
    try {
      const credentials = await googleAuthorization.request(popup, googleSubject);
      if (this.isDisposed || pending.cancelled) return Result.err({ code: "cancelled" });
      if (Result.isError(credentials)) return Result.err(credentials.error);
      if (
        googleSubject !== undefined &&
        credentials.value.googleAccount.googleSubject !== googleSubject
      ) {
        LOGGER.warn("identity.google.authorization.failed", {
          operation: "request_credentials",
          code: "account_mismatch",
        });
        return Result.err({ code: "authorization_failed" });
      }
      this.googleSubject ??= credentials.value.googleAccount.googleSubject;
      return Result.ok(credentials.value);
    } catch (e) {
      if (this.isDisposed || pending.cancelled) return Result.err({ code: "cancelled" });
      LOGGER.warn("identity.google.authorization.failed", {
        operation: "request_credentials",
        code: "authorization_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "authorization_failed", cause: e });
    }
  }

  private finishOperation(): void {
    switch (this.status) {
      case "disposing":
        this.status = "disposed";
        this.disposeLifecycle();
        return;
      case "busy":
        this.status = "ready";
        return;
      case "ready":
      case "disposed":
        return;
    }
  }

  private disposeLifecycle(): void {
    try {
      this.lifecycle?.dispose();
    } catch (e) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "pubky_dispose",
        ...safeErrorLogFields(e),
      });
    }
  }

  private publish(state: GoogleIdentityViewState): void {
    if (this.isDisposed) return;
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (e) {
        LOGGER.warn("identity.google.state_listener.failed", {
          state: state.status,
          ...safeErrorLogFields(e),
        });
      }
    }
  }

  private async initializeDependencies(): Promise<boolean> {
    if (this.googleAuthorization && this.lifecycle) return true;
    const factories = await this.resolveFactories();
    if (this.isDisposed) return false;

    const authorization = factories.createAuthorization(this.googleClientId);
    try {
      const lifecycle = factories.createLifecycle(this.homegateBaseUrl, globalThis.location.origin);
      this.googleAuthorization = authorization;
      this.lifecycle = lifecycle;
      return true;
    } catch (e) {
      try {
        authorization.dispose();
      } catch (e) {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: "construction_authorization_dispose",
          ...safeErrorLogFields(e),
        });
      }
      throw e;
    }
  }

  private async resolveFactories() {
    const [createAuthorization, createLifecycle] = await Promise.all([
      this.createAuthorization ??
        import("./gia/GoogleImplicitAuthorization").then(
          (module) => (googleClientId: string) =>
            new module.GoogleImplicitAuthorization(googleClientId),
        ),
      this.createLifecycle ??
        import("./GoogleIdentityLifecycle").then(
          (module) => (homegateBaseUrl: string, passportOrigin: string) =>
            new module.GoogleIdentityLifecycle(homegateBaseUrl, passportOrigin),
        ),
    ]);
    return { createAuthorization, createLifecycle };
  }
}

/** Credentials that stay valid long enough to finish an operation; otherwise `undefined`. */
function reusableCredentials(
  credentials: GoogleIdentityCredentials,
): GoogleIdentityCredentials | undefined {
  const expiresAt = credentials.driveAccessTokenExpiresAt;
  return expiresAt !== null && expiresAt > Date.now() + CREDENTIAL_EXPIRY_MARGIN_MS
    ? credentials
    : undefined;
}

function startEstablishment(
  lifecycle: Lifecycle,
  operation: EstablishmentOperation,
  credentials: GoogleIdentityCredentials,
  report: (progress: GoogleIdentityProgress) => void,
  allowWithoutVisibleBackup: boolean,
) {
  switch (operation) {
    case "establish":
      return lifecycle.establishIdentity(credentials, report, allowWithoutVisibleBackup);
    case "replace_invalid_passport_file":
      return lifecycle.replaceInvalidPassportFile(credentials, report, allowWithoutVisibleBackup);
    case "replace_undecryptable_passport_file":
      return lifecycle.replaceUndecryptablePassportFile(
        credentials,
        report,
        allowWithoutVisibleBackup,
      );
  }
}
