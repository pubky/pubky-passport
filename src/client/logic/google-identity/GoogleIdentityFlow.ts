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
  GoogleIdentityLifecycle,
  type GoogleIdentityOperationError,
  type GoogleIdentityPhase,
} from "./GoogleIdentityLifecycle";

export type { GoogleIdentityPhase } from "./GoogleIdentityLifecycle";

export type GoogleIdentityConfiguration = {
  googleClientId: string;
  homegateBaseUrl: string;
};

/** Safe progress emitted while Passport creates or restores a Google-backed identity. */
export type GoogleIdentityFlowState =
  | { status: "requesting-authorization" }
  | { status: "establishing"; progress: GoogleIdentityPhase }
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

type GoogleIdentityFlowFailureCode =
  | "authorization_failed"
  | "cancelled"
  | "operation_failed";

export type GoogleIdentityFlowError =
  | GoogleIdentityOperationError
  | GoogleImplicitAuthorizationError
  | { code: GoogleIdentityFlowFailureCode };

export type EstablishGoogleIdentityResult = ResultType<
  EstablishedGoogleIdentity,
  GoogleIdentityFlowError
>;

export type DetachGoogleIdentityResult = ResultType<
  { deletionStatus: "deleted" | "missing" },
  GoogleIdentityFlowError
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
export class GoogleIdentityFlow {
  private readonly googleAuthorization: GoogleImplicitAuthorization;
  private readonly operations: GoogleIdentityLifecycle;
  private operationsDisposed = false;
  private operationPending = false;
  private googleAccountId: string | undefined;
  private disposed = false;

  constructor(
    configuration: GoogleIdentityConfiguration,
    private readonly onState: (state: GoogleIdentityFlowState) => void,
  ) {
    try {
      const repository = new LocalStorageIdentityRepository();
      this.googleAuthorization = new GoogleImplicitAuthorization(configuration.googleClientId);
      this.operations = new GoogleIdentityLifecycle(
        repository,
        configuration.homegateBaseUrl,
        globalThis.location.origin,
      );
    } catch (error) {
      LOGGER.error("identity.google.flow.failed", {
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
      return failure("cancelled");
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
        if (this.disposed) return failure("cancelled");
        return failure(established.error);
      }
      if (this.disposed) return failure("cancelled");

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
      return failure(this.disposed ? "cancelled" : "operation_failed");
    } finally {
      this.finishOperation();
    }
  }

  /**
   * Deletes the Google Drive backups first, then removes the local identity.
   * A Google Drive failure leaves the local identity untouched.
   */
  async detachIdentity(
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<DetachGoogleIdentityResult> {
    const authorized = await this.requestGoogleCredentials(expectedGoogleAccountId);
    if (Result.isError(authorized)) return Result.err(authorized.error);
    if (this.disposed) {
      this.finishOperation();
      return failure("cancelled");
    }

    try {
      this.setFlowState({ status: "detaching" });
      const detached = await this.operations.detachIdentity(
        authorized.value,
        publicIdentity,
        expectedGoogleAccountId,
      );
      if (this.disposed) return failure("cancelled");
      return detached;
    } catch {
      LOGGER.warn("identity.google.action.failed", {
        operation: "detach",
        code: "unexpected_failure",
      });
      return failure(this.disposed ? "cancelled" : "operation_failed");
    } finally {
      this.finishOperation();
    }
  }

  /** Cancels Google authorization and releases Pubky SDK resources owned by this flow. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.googleAccountId = undefined;
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
    expectedGoogleAccountId?: string,
  ): Promise<ResultType<GoogleIdentityCredentials, GoogleIdentityFlowError>> {
    if (this.disposed) return failure("cancelled");
    if (this.operationPending) return failure("operation_failed");

    this.operationPending = true;
    this.setFlowState({ status: "requesting-authorization" });

    try {
      const accountId = expectedGoogleAccountId ?? this.googleAccountId;
      const credentials = await this.googleAuthorization.request(accountId);
      if (this.disposed) {
        this.operationPending = false;
        this.disposeOperationsOnce();
        return failure("cancelled");
      }
      if (Result.isError(credentials)) {
        this.operationPending = false;
        return Result.err(credentials.error);
      }
      if (accountId !== undefined && credentials.value.googleAccount.id !== accountId) {
        this.operationPending = false;
        return failure("authorization_failed");
      }
      this.googleAccountId ??= credentials.value.googleAccount.id;
      return Result.ok(credentials.value);
    } catch {
      this.operationPending = false;
      return failure("authorization_failed");
    }
  }

  private createProgressReporter(): {
    report: (progress: GoogleIdentityPhase) => void;
    stop: () => void;
  } {
    let active = true;
    return {
      report: (progress) => {
        if (active && !this.disposed) {
          this.setFlowState({ status: "establishing", progress });
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

  private setFlowState(state: GoogleIdentityFlowState): void {
    if (this.disposed) return;
    try {
      this.onState(state);
    } catch {
      LOGGER.warn("identity.google.state_listener.failed");
    }
  }
}

function failure<Success = never>(
  error: GoogleIdentityFlowFailureCode | GoogleIdentityFlowError,
): ResultType<Success, GoogleIdentityFlowError> {
  return Result.err(typeof error === "string" ? { code: error } : error);
}
