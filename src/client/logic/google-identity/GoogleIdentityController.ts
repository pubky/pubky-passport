import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleAccountProfile } from "../../../libs/googleAccountProfile";
import { LOGGER, safeErrorLogFields } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import type {
  GoogleImplicitAuthorization,
  GoogleIdentityCredentials,
  GoogleImplicitAuthorizationError,
} from "./gia/GoogleImplicitAuthorization";
import type { PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";
import type {
  GoogleIdentityOperations,
  GoogleIdentityOperationError,
  GoogleIdentityProgress,
} from "./GoogleIdentityOperations";

export type { GoogleIdentityProgress } from "./GoogleIdentityOperations";

/** Safe progress emitted while Passport creates or restores a Google-backed identity. */
export type GoogleIdentityViewState =
  | { status: "requesting-authorization" }
  | { status: "establishing"; progress: GoogleIdentityProgress }
  | { status: "detaching" };

/** Safe setup or restore details returned after the identity is active locally. */
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
  | GoogleIdentityOperationError
  | GoogleImplicitAuthorizationError
  | CodedFailure<"authorization_failed" | "cancelled" | "operation_failed">;

type GoogleIdentityErrorDetailCode = Extract<
  GoogleIdentityOperationError,
  { detailCode: string }
>["detailCode"];

/** Error fields explicitly allowed to cross into React state or rendered output. */
export type GoogleIdentityViewError = {
  code: GoogleIdentityError["code"];
  detailCode?: GoogleIdentityErrorDetailCode;
};

export type EstablishGoogleIdentityResult = ResultType<
  EstablishedGoogleIdentity,
  GoogleIdentityViewError
>;

export type DetachGoogleIdentityResult = ResultType<void, GoogleIdentityViewError>;

/**
 * Owns one screen's Google authorization and identity operation lifecycle.
 *
 * Each public operation first obtains fresh short-lived Google credentials. The
 * credentials stay in this browser object, are passed directly to the concrete
 * Google-backed operation, and never enter UI state. Only one operation may run at
 * a time. Calling {@link dispose} cancels authorization and suppresses later UI
 * updates while allowing already-started cleanup to finish safely.
 *
 * Public asynchronous operations settle with a Result and do not intentionally reject.
 */
export class GoogleIdentityController {
  private googleAuthorization: GoogleImplicitAuthorization | undefined;
  private operations: GoogleIdentityOperations | undefined;
  private operationsDisposed = false;
  private operationPending = false;
  private googleSubject: string | undefined;
  private disposed = false;

  constructor(
    private readonly googleClientId: string,
    private readonly homegateBaseUrl: string,
    private readonly onState: (state: GoogleIdentityViewState) => void,
  ) {}

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

  private async runIdentityEstablishment(
    operation: "establish" | "replace_invalid_passport_file",
  ): Promise<EstablishGoogleIdentityResult> {
    const authorized = await this.requestGoogleCredentials();
    if (Result.isError(authorized)) return Result.err(withoutCause(authorized.error));
    if (this.disposed) {
      this.finishOperation();
      return Result.err({ code: "cancelled" });
    }

    try {
      const operations = this.operations;
      if (!operations) {
        LOGGER.warn("identity.google.action.failed", {
          operation,
          code: "operations_unavailable",
        });
        return Result.err({ code: "operation_failed" });
      }
      const progress = this.createProgressReporter();
      const establishment =
        operation === "establish"
          ? operations.establishIdentity(authorized.value, progress.report)
          : operations.replaceInvalidPassportFile(authorized.value, progress.report);
      const established = await establishment.finally(() => {
        progress.stop();
      });

      if (Result.isError(established)) {
        LOGGER.warn("identity.google.action.failed", {
          operation,
          code: established.error.code,
          ...safeErrorLogFields(established.error),
        });
        if (this.disposed) return Result.err({ code: "cancelled" });
        return Result.err(withoutCause(established.error));
      }
      if (this.disposed) return Result.err({ code: "cancelled" });

      const googleAccount = authorized.value.googleAccount;
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
    } catch (cause) {
      LOGGER.warn("identity.google.action.failed", {
        operation,
        code: "unexpected_failure",
        ...safeErrorLogFields(cause),
      });
      return this.disposed
        ? Result.err({ code: "cancelled" })
        : Result.err({ code: "operation_failed" });
    } finally {
      this.finishOperation();
    }
  }

  /** Allows a new establishment flow to choose a different Google account. */
  clearPinnedGoogleSubject(): void {
    this.googleSubject = undefined;
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
    const authorized = await this.requestGoogleCredentials(expectedGoogleSubject);
    if (Result.isError(authorized)) return Result.err(withoutCause(authorized.error));
    if (this.disposed) {
      this.finishOperation();
      return Result.err({ code: "cancelled" });
    }

    try {
      const operations = this.operations;
      if (!operations) {
        LOGGER.warn("identity.google.action.failed", {
          operation: "detach",
          code: "operations_unavailable",
        });
        return Result.err({ code: "operation_failed" });
      }
      this.setViewState({ status: "detaching" });
      const detached = await operations.detachIdentity(
        authorized.value,
        publicIdentity,
        expectedGoogleSubject,
      );
      if (this.disposed) return Result.err({ code: "cancelled" });
      if (Result.isError(detached)) {
        LOGGER.warn("identity.google.action.failed", {
          operation: "detach",
          code: detached.error.code,
          ...safeErrorLogFields(detached.error),
        });
        return Result.err(withoutCause(detached.error));
      }
      return Result.ok();
    } catch (cause) {
      LOGGER.warn("identity.google.action.failed", {
        operation: "detach",
        code: "unexpected_failure",
        ...safeErrorLogFields(cause),
      });
      return this.disposed
        ? Result.err({ code: "cancelled" })
        : Result.err({ code: "operation_failed" });
    } finally {
      this.finishOperation();
    }
  }

  /** Cancels Google authorization and releases Pubky SDK resources owned by this controller. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.googleSubject = undefined;
    try {
      this.googleAuthorization?.dispose();
    } catch (cause) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "authorization_dispose",
        ...safeErrorLogFields(cause),
      });
    } finally {
      this.operations?.abortRequests();
      if (!this.operationPending) this.disposeOperationsOnce();
    }
  }

  private async requestGoogleCredentials(
    expectedGoogleSubject?: string,
  ): Promise<ResultType<GoogleIdentityCredentials, GoogleIdentityError>> {
    if (this.disposed) return Result.err({ code: "cancelled" });
    if (this.operationPending) return Result.err({ code: "operation_failed" });

    this.operationPending = true;
    this.setViewState({ status: "requesting-authorization" });

    try {
      if (!(await this.initializeDependencies())) {
        this.operationPending = false;
        return Result.err({ code: "cancelled" });
      }
    } catch (cause) {
      this.operationPending = false;
      LOGGER.error("identity.google.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
        ...safeErrorLogFields(cause),
      });
      return Result.err({ code: "operation_failed", cause });
    }

    try {
      const googleAuthorization = this.googleAuthorization;
      if (!googleAuthorization) {
        this.operationPending = false;
        LOGGER.warn("identity.google.authorization.failed", {
          operation: "request_credentials",
          code: "authorization_unavailable",
        });
        return Result.err({ code: "operation_failed" });
      }
      const googleSubject = expectedGoogleSubject ?? this.googleSubject;
      const credentials = await googleAuthorization.request(googleSubject);
      if (this.disposed) {
        this.operationPending = false;
        this.disposeOperationsOnce();
        return Result.err({ code: "cancelled" });
      }
      if (Result.isError(credentials)) {
        this.operationPending = false;
        return Result.err(credentials.error);
      }
      if (
        googleSubject !== undefined &&
        credentials.value.googleAccount.googleSubject !== googleSubject
      ) {
        this.operationPending = false;
        LOGGER.warn("identity.google.authorization.failed", {
          operation: "request_credentials",
          code: "account_mismatch",
        });
        return Result.err({ code: "authorization_failed" });
      }
      this.googleSubject ??= credentials.value.googleAccount.googleSubject;
      return Result.ok(credentials.value);
    } catch (cause) {
      this.operationPending = false;
      if (this.disposed) {
        this.disposeOperationsOnce();
        return Result.err({ code: "cancelled" });
      }
      LOGGER.warn("identity.google.authorization.failed", {
        operation: "request_credentials",
        code: "authorization_failed",
        ...safeErrorLogFields(cause),
      });
      return Result.err({ code: "authorization_failed", cause });
    }
  }

  private createProgressReporter(): {
    report: (progress: GoogleIdentityProgress) => void;
    stop: () => void;
  } {
    let active = true;
    return {
      report: (progress) => {
        if (active && !this.disposed) {
          this.setViewState({ status: "establishing", progress });
        }
      },
      stop: () => {
        active = false;
      },
    };
  }

  private finishOperation(): void {
    this.operationPending = false;
    if (this.disposed) this.disposeOperationsOnce();
  }

  private disposeOperationsOnce(): void {
    if (this.operationsDisposed) return;
    this.operationsDisposed = true;
    try {
      this.operations?.dispose();
    } catch (cause) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "pubky_dispose",
        ...safeErrorLogFields(cause),
      });
    }
  }

  private setViewState(state: GoogleIdentityViewState): void {
    if (this.disposed) return;
    try {
      this.onState(state);
    } catch (cause) {
      LOGGER.warn("identity.google.state_listener.failed", {
        state: state.status,
        ...safeErrorLogFields(cause),
      });
    }
  }

  private async initializeDependencies(): Promise<boolean> {
    if (this.googleAuthorization && this.operations) return true;
    const [authorizationModule, operationsModule] = await Promise.all([
      import("./gia/GoogleImplicitAuthorization"),
      import("./GoogleIdentityOperations"),
    ]);
    if (this.disposed) return false;

    const authorization = new authorizationModule.GoogleImplicitAuthorization(this.googleClientId);
    try {
      const operations = new operationsModule.GoogleIdentityOperations(
        this.homegateBaseUrl,
        globalThis.location.origin,
      );
      this.googleAuthorization = authorization;
      this.operations = operations;
      return true;
    } catch (cause) {
      try {
        authorization.dispose();
      } catch (cleanupCause) {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: "construction_authorization_dispose",
          ...safeErrorLogFields(cleanupCause),
        });
      }
      throw cause;
    }
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
