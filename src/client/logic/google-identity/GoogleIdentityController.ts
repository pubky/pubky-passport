import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import {
  GoogleImplicitAuthorization,
  type GoogleIdentityCredentials,
  type GoogleImplicitAuthorizationError,
} from "./GoogleImplicitAuthorization";
import type { GoogleAccountProfile } from "../local-identity/localIdentityModels";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";
import type { PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";
import {
  GoogleIdentityOperations,
  type GoogleIdentityOperationError,
  type GoogleIdentityProgress,
} from "./GoogleIdentityOperations";

export type { GoogleIdentityProgress } from "./GoogleIdentityOperations";

export type GoogleIdentityConfiguration = {
  googleClientId: string;
  homegateBaseUrl: string;
};

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
  | {
    code:
      | "authorization_failed"
      | "cancelled"
      | "operation_failed";
  };

export type EstablishGoogleIdentityResult = ResultType<
  EstablishedGoogleIdentity,
  GoogleIdentityError
>;

export type DetachGoogleIdentityResult = ResultType<
  { deletionStatus: "deleted" | "missing" },
  GoogleIdentityError
>;

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
    configuration: GoogleIdentityConfiguration,
    private readonly onState: (state: GoogleIdentityViewState) => void,
  ) {
    try {
      const repository = new LocalStorageIdentityRepository();
      this.googleAuthorization = new GoogleImplicitAuthorization(configuration.googleClientId);
      this.operations = new GoogleIdentityOperations(
        repository,
        configuration.homegateBaseUrl,
        globalThis.location.origin,
      );
    } catch (error) {
      LOGGER.error("identity.google.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
      });
      throw error;
    }
  }

  /** Restores or creates and activates an identity. */
  async establishIdentity(): Promise<EstablishGoogleIdentityResult> {
    const authorized = await this.requestGoogleCredentials();
    if (Result.isError(authorized)) return Result.err(authorized.error);
    if (this.disposed) {
      this.finishOperation();
      return Result.err({ code: "cancelled" });
    }

    try {
      const progress = this.createProgressReporter();
      const established = await this.operations.establishIdentity(
        authorized.value,
        progress.report,
      ).finally(() => {
        progress.stop();
      });

      if (Result.isError(established)) {
        LOGGER.warn("identity.google.action.failed", {
          operation: "establish",
          code: established.error.code,
        });
        if (this.disposed) return Result.err({ code: "cancelled" });
        return Result.err(established.error);
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
        operation: "establish",
        code: "unexpected_failure",
      });
      return Result.err({ code: this.disposed ? "cancelled" : "operation_failed" });
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
    if (Result.isError(authorized)) return Result.err(authorized.error);
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
      return detached;
    } catch {
      LOGGER.warn("identity.google.action.failed", {
        operation: "detach",
        code: "unexpected_failure",
      });
      return Result.err({ code: this.disposed ? "cancelled" : "operation_failed" });
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
      LOGGER.warn("identity.google.state_listener.failed");
    }
  }
}
