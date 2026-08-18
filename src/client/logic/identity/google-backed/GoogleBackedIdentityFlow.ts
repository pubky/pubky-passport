import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PubkyPublicIdentity } from "../../pubky/pubkyIdentityKey";
import { LOGGER } from "../../../../libs/logger/logger";
import {
  GoogleImplicitAuthorization,
  type GoogleAccountProfile,
  type GoogleBackedIdentityCredentials,
  type GoogleImplicitAuthorizationError,
} from "../../google-authorization/GoogleImplicitAuthorization";
import type { LocalStorageIdentityRepository } from "../local/LocalStorageIdentityRepository";
import {
  GoogleBackedIdentityOperations,
  type GoogleBackedIdentityOperationError,
  type GoogleBackedIdentityProgress,
} from "./GoogleBackedIdentityOperations";

/** Safe progress emitted while Passport creates or restores a Google-backed identity. */
export type GoogleIdentityFlowState =
  | { status: "ready" }
  | { status: "authorization-failed" }
  | { status: "requesting-authorization" }
  | { status: "establishing"; progress: GoogleBackedIdentityProgress }
  | { status: "detaching" };

/** Safe setup or restore details returned after the identity is active locally. */
export type EstablishedGoogleIdentity =
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

/** Safe errors that a Google identity screen may render. */
type GoogleIdentityFlowFailureCode =
  | "authorization_failed"
  | "cancelled"
  | "operation_failed";

export type GoogleIdentityFlowError =
  | GoogleBackedIdentityOperationError
  | GoogleImplicitAuthorizationError
  | { code: GoogleIdentityFlowFailureCode };

/** Result of creating or restoring a Google-backed Pubky identity. */
export type EstablishGoogleIdentityResult = ResultType<
  EstablishedGoogleIdentity,
  GoogleIdentityFlowError
>;

/** Result of deleting an identity's Google backups and local copy. */
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
export class GoogleBackedIdentityFlow {
  private operations: GoogleBackedIdentityOperations | undefined;
  private operationPending = false;
  private googleAccountId: string | undefined;
  private disposed = false;

  constructor(
    private repository: LocalStorageIdentityRepository,
    private googleAuthorization: GoogleImplicitAuthorization,
    private homegateBaseUrl: string,
    private passportOrigin: string,
    private onState: (state: GoogleIdentityFlowState) => void,
  ) { }

  /** Prepares or retries Google authorization and reports whether the flow is ready. */
  start(): void {
    if (this.disposed || this.operationPending) return;

    try {
      this.googleAuthorization.dispose();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "authorization_dispose",
      });
    }

    void this.googleAuthorization.prepare()
      .then((prepared) => {
        if (this.disposed) return;
        this.setFlowState(Result.isError(prepared)
          ? { status: "authorization-failed" }
          : { status: "ready" });
      })
      .catch(() => {
        if (!this.disposed) {
          this.setFlowState({ status: "authorization-failed" });
        }
      });
  }

  /** Obtains Google access, then restores or creates and activates an identity. */
  async establishIdentity(): Promise<EstablishGoogleIdentityResult> {
    const authorized = await this.requestGoogleCredentials();
    if (Result.isError(authorized)) return Result.err(authorized.error);

    try {
      const progress = this.createProgressReporter();
      const established = await this.getOperations().establishIdentity(
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
   * Deletes the verified Google backups first, then removes the local identity.
   * A Google or Drive failure leaves the local identity untouched.
   */
  async detachIdentity(
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<DetachGoogleIdentityResult> {
    const authorized = await this.requestGoogleCredentials(expectedGoogleAccountId);
    if (Result.isError(authorized)) return Result.err(authorized.error);

    try {
      this.setFlowState({ status: "detaching" });
      const detached = await this.getOperations().detachIdentity(
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
      this.operations?.abortRequests();
      if (!this.operationPending) this.disposeOperationsOnce();
    }
  }

  private async requestGoogleCredentials(
    expectedGoogleAccountId?: string,
  ): Promise<ResultType<GoogleBackedIdentityCredentials, GoogleIdentityFlowError>> {
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
        this.setFlowState({ status: "authorization-failed" });
        return Result.err(credentials.error);
      }
      if (accountId !== undefined && credentials.value.googleAccount.id !== accountId) {
        this.operationPending = false;
        this.setFlowState({ status: "authorization-failed" });
        return failure("authorization_failed");
      }
      this.googleAccountId ??= credentials.value.googleAccount.id;
      return Result.ok(credentials.value);
    } catch {
      this.operationPending = false;
      this.setFlowState({ status: "authorization-failed" });
      return failure("authorization_failed");
    }
  }

  private createProgressReporter(): {
    report: (progress: GoogleBackedIdentityProgress) => void;
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
    if (!this.disposed) this.setFlowState({ status: "ready" });
    if (this.disposed) this.disposeOperationsOnce();
  }

  private getOperations(): GoogleBackedIdentityOperations {
    this.operations ??= new GoogleBackedIdentityOperations(
      this.repository,
      this.homegateBaseUrl,
      this.passportOrigin,
    );
    return this.operations;
  }

  private disposeOperationsOnce(): void {
    const operations = this.operations;
    if (!operations) return;
    this.operations = undefined;
    try {
      operations.dispose();
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
