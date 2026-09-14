import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type {
  GoogleImplicitAuthorization,
  GoogleIdentityCredentials,
  GoogleImplicitAuthorizationError,
} from "./gia/GoogleImplicitAuthorization";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import type {
  GoogleIdentityLifecycle,
  GoogleIdentityLifecycleError,
  GoogleIdentityProgress,
} from "./GoogleIdentityLifecycle";

export type { GoogleIdentityProgress } from "./GoogleIdentityLifecycle";

/** Safe setup or restore details published after the identity is active locally. */
type EstablishedGoogleIdentity =
  | {
      establishmentMode: "created";
      googleAccount: GoogleAccountProfile;
      publicIdentity: PubkyPublicIdentity;
      visibleRecoveryCopyStatus: "created" | "unconfirmed";
    }
  | {
      establishmentMode: "restored";
      googleAccount: GoogleAccountProfile;
      publicIdentity: PubkyPublicIdentity;
    };

export type GoogleIdentityError =
  | GoogleIdentityLifecycleError
  | GoogleImplicitAuthorizationError
  | CodedFailure<"authorization_failed" | "cancelled" | "operation_failed">;

type GoogleIdentityErrorDetailCode = Extract<
  GoogleIdentityLifecycleError,
  { detailCode: string }
>["detailCode"];

/** Error fields explicitly allowed to cross into React state or rendered output. */
export type GoogleIdentityViewError = {
  code: GoogleIdentityError["code"];
  detailCode?: GoogleIdentityErrorDetailCode;
};

/** Render-safe states published while Passport creates, restores, or detaches a Google-backed identity. */
export type GoogleIdentityViewState =
  | { status: "idle" }
  | { status: "requesting-authorization" }
  | { status: "establishing"; progress: GoogleIdentityProgress }
  | { status: "established"; identity: EstablishedGoogleIdentity }
  | { status: "detaching" }
  | { status: "detached" }
  | { status: "failed"; error: GoogleIdentityViewError };

export type EstablishGoogleIdentityResult = ResultType<
  EstablishedGoogleIdentity,
  GoogleIdentityViewError
>;

export type DetachGoogleIdentityResult = ResultType<void, GoogleIdentityViewError>;

type GoogleAuthorization = Pick<GoogleImplicitAuthorization, "request" | "dispose">;
type Lifecycle = Pick<
  GoogleIdentityLifecycle,
  | "establishIdentity"
  | "replaceInvalidPassportFile"
  | "detachIdentity"
  | "abortRequests"
  | "dispose"
>;
type EstablishmentOperation = "establish" | "replace_invalid_passport_file";
type GoogleIdentityOperation = EstablishmentOperation | "detach";
type OperationWork<Success> = (
  credentials: GoogleIdentityCredentials,
  lifecycle: Lifecycle,
) => Promise<ResultType<Success, GoogleIdentityError>>;

/** `disposing`: dispose() ran mid-operation; lifecycle disposal waits for it to settle. */
type ControllerStatus = "ready" | "busy" | "disposing" | "disposed";

const IDLE_STATE: GoogleIdentityViewState = { status: "idle" };

/**
 * Presentation-facing controller for one screen's Google authorization and identity flow.
 *
 * Each public operation first obtains fresh short-lived Google credentials. The
 * credentials stay in this browser object, are passed directly to the concrete
 * Google-backed operation, and never enter UI state. Only one operation may run at
 * a time. Calling {@link dispose} cancels authorization and suppresses later UI
 * updates while allowing already-started cleanup to finish safely.
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
   * Deletes the Google Drive Passport files first, then removes the local identity.
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

  /** Returns to idle and lets a new establishment flow choose a different Google account. */
  reset(): void {
    this.googleSubject = undefined;
    if (this.status === "ready") this.publish(IDLE_STATE);
  }

  /** Cancels Google authorization and releases Pubky SDK resources owned by this controller. */
  dispose(): void {
    if (this.isDisposed) return;
    const operationPending = this.status === "busy";
    this.status = operationPending ? "disposing" : "disposed";
    this.googleSubject = undefined;
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
      if (!operationPending) this.disposeLifecycle();
    }
  }

  private get isDisposed(): boolean {
    return this.status === "disposing" || this.status === "disposed";
  }

  private runIdentityEstablishment(
    operation: EstablishmentOperation,
  ): Promise<EstablishGoogleIdentityResult> {
    return this.runOperation(
      operation,
      undefined,
      async (credentials, lifecycle) => {
        const progress = this.createProgressReporter();
        const establishment =
          operation === "establish"
            ? lifecycle.establishIdentity(credentials, progress.report)
            : lifecycle.replaceInvalidPassportFile(credentials, progress.report);
        const established = await establishment.finally(progress.stop);
        if (Result.isError(established)) return Result.err(established.error);

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
    );
  }

  /**
   * Runs one authorized operation with a single entry and exit for the busy state,
   * publishing the terminal state unless the controller was disposed meanwhile.
   */
  private async runOperation<Success>(
    operation: GoogleIdentityOperation,
    expectedGoogleSubject: string | undefined,
    work: OperationWork<Success>,
    toState: (value: Success) => GoogleIdentityViewState,
  ): Promise<ResultType<Success, GoogleIdentityViewError>> {
    if (this.status !== "ready") {
      return Result.err({ code: this.status === "busy" ? "operation_failed" : "cancelled" });
    }
    this.status = "busy";
    this.publish({ status: "requesting-authorization" });

    try {
      const outcome = await this.authorizeAndRun(operation, expectedGoogleSubject, work);
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
  ): Promise<ResultType<Success, GoogleIdentityError>> {
    const authorized = await this.requestGoogleCredentials(expectedGoogleSubject);
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
    try {
      if (!(await this.initializeDependencies())) return Result.err({ code: "cancelled" });
    } catch (e) {
      LOGGER.error("identity.google.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "operation_failed", cause: e });
    }

    const googleAuthorization = this.googleAuthorization;
    if (!googleAuthorization) {
      LOGGER.warn("identity.google.authorization.failed", {
        operation: "request_credentials",
        code: "authorization_unavailable",
      });
      return Result.err({ code: "operation_failed" });
    }

    const googleSubject = expectedGoogleSubject ?? this.googleSubject;
    try {
      const credentials = await googleAuthorization.request(googleSubject);
      if (this.isDisposed) return Result.err({ code: "cancelled" });
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
      if (this.isDisposed) return Result.err({ code: "cancelled" });
      LOGGER.warn("identity.google.authorization.failed", {
        operation: "request_credentials",
        code: "authorization_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "authorization_failed", cause: e });
    }
  }

  private createProgressReporter(): {
    report: (progress: GoogleIdentityProgress) => void;
    stop: () => void;
  } {
    let active = true;
    return {
      report: (progress) => {
        if (active) this.publish({ status: "establishing", progress });
      },
      stop: () => {
        active = false;
      },
    };
  }

  private finishOperation(): void {
    if (this.status === "disposing") {
      this.status = "disposed";
      this.disposeLifecycle();
    } else if (this.status === "busy") {
      this.status = "ready";
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

function withoutCause(error: GoogleIdentityError): GoogleIdentityViewError {
  switch (error.code) {
    case "wrapping_key_failed":
      return { code: error.code, detailCode: error.detailCode };
    case "homeserver_signup_token_failed":
      return { code: error.code, detailCode: error.detailCode };
    default:
      return { code: error.code };
  }
}
