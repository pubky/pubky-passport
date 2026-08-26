import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import {
  GoogleImplicitAuthorization,
  type GoogleIdentityCredentials,
  type GoogleImplicitAuthorizationError,
} from "./GoogleImplicitAuthorization";
import type { GoogleAccountProfile } from "../local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";
import {
  GoogleIdentityOperations,
  type GoogleIdentityOperationError,
  type GoogleIdentityProgress,
} from "./GoogleIdentityOperations";

export type { GoogleIdentityProgress } from "./GoogleIdentityOperations";

/** Safe progress emitted while Passport creates or restores a Google-backed identity. */
export type GoogleIdentityViewState =
  | { status: "requesting-authorization" }
  | { status: "establishing"; progress: GoogleIdentityProgress }
  | { status: "detaching" };

/** Safe setup or restore details returned after the identity is active locally. */
export type EstablishedGoogleIdentity = |
  {
    establishmentMode: "created";
    googleAccount: GoogleAccountProfile;
    publicIdentity: PubkyPublicIdentity;
    visibleRecoveryCopyStatus: "created" | "unconfirmed";
  } |
  {
    establishmentMode: "restored";
    googleAccount: GoogleAccountProfile;
    publicIdentity: PubkyPublicIdentity;
  };

export type GoogleIdentityError =
  | GoogleIdentityOperationError
  | GoogleImplicitAuthorizationError
  | CodedFailure<
    | "authorization_failed"
    | "cancelled"
    | "operation_failed"
  >;

export type GoogleIdentityErrorDetailCode = Extract<
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
 */
export class GoogleIdentityController {
  private readonly googleAuthorization: GoogleImplicitAuthorization;
  private readonly operations: GoogleIdentityOperations;
  private operationsDisposed = false;
  private operationPending = false;
  private googleSubject: string | undefined;
  private disposed = false;

  constructor(
    googleClientId: string,
    homegateBaseUrl: string,
    private readonly onState: (state: GoogleIdentityViewState) => void,
  ) {
    try {
      this.googleAuthorization = new GoogleImplicitAuthorization(googleClientId);
      this.operations = new GoogleIdentityOperations(
        homegateBaseUrl,
        globalThis.location.origin,
      );
    } catch {
      LOGGER.error("identity.google.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
      });
      throw new Error("Google identity initialization unavailable.");
    }
  }

  /** Restores or creates and activates an identity. */
  async establishIdentity(): Promise<EstablishGoogleIdentityResult> {
    return this.runIdentityEstablishment("establish");
  }

  /** Permanently removes a malformed Drive file and immediately creates a replacement identity. */
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
      const progress = this.createProgressReporter();
      const establishment = operation === "establish"
        ? this.operations.establishIdentity(authorized.value, progress.report)
        : this.operations.replaceInvalidPassportFile(authorized.value, progress.report);
      const established = await establishment.finally(() => {
        progress.stop();
      });

      if (Result.isError(established)) {
        LOGGER.warn("identity.google.action.failed", {
          operation,
          code: established.error.code,
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
    } catch {
      LOGGER.warn("identity.google.action.failed", {
        operation,
        code: "unexpected_failure",
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
      this.setViewState({ status: "detaching" });
      const detached = await this.operations.detachIdentity(
        authorized.value,
        publicIdentity,
        expectedGoogleSubject,
      );
      if (this.disposed) return Result.err({ code: "cancelled" });
      return Result.isError(detached)
        ? Result.err(withoutCause(detached.error))
        : Result.ok();
    } catch {
      LOGGER.warn("identity.google.action.failed", {
        operation: "detach",
        code: "unexpected_failure",
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
      this.googleAuthorization.dispose();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "authorization_dispose",
      });
    } finally {
      this.operations.abortRequests();
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
      const googleSubject = expectedGoogleSubject ?? this.googleSubject;
      const credentials = await this.googleAuthorization.request(googleSubject);
      if (this.disposed) {
        this.operationPending = false;
        this.disposeOperationsOnce();
        return Result.err({ code: "cancelled" });
      }
      if (Result.isError(credentials)) {
        this.operationPending = false;
        return Result.err(credentials.error);
      }
      if (googleSubject !== undefined && credentials.value.googleAccount.googleSubject !== googleSubject) {
        this.operationPending = false;
        return Result.err({ code: "authorization_failed" });
      }
      this.googleSubject ??= credentials.value.googleAccount.googleSubject;
      return Result.ok(credentials.value);
    } catch {
      this.operationPending = false;
      if (this.disposed) {
        this.disposeOperationsOnce();
        return Result.err({ code: "cancelled" });
      }
      LOGGER.warn("identity.google.authorization.failed", {
        operation: "request_credentials",
        code: "authorization_failed",
      });
      return Result.err({ code: "authorization_failed" });
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
      this.operations.dispose();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "pubky_dispose",
      });
    }
  }

  private setViewState(state: GoogleIdentityViewState): void {
    if (this.disposed) return;
    try {
      this.onState(state);
    } catch {
      LOGGER.warn("identity.google.state_listener.failed", {
        state: state.status,
      });
    }
  }
}

function withoutCause(error: GoogleIdentityError): GoogleIdentityViewError {
  switch (error.code) {
    case "wrapping_key_failed":
      return { code: error.code, detailCode: error.detailCode };
    case "homeserver_signup_invitation_failed":
      return { code: error.code, detailCode: error.detailCode };
    default:
      return { code: error.code };
  }
}
