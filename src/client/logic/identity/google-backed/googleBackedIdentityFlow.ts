import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleAccountProfile } from "./googleAccountProfile";
import type { PubkyPublicIdentity } from "../pubkyPublicIdentity";
import { LOGGER } from "../../../../libs/logger/logger";
import {
  GoogleImplicitAuthorization,
} from "../../google-authorization/googleImplicitAuthorization";
import type { LocalStorageIdentityRepository } from "../local/localStorageIdentityRepository";
import {
  GoogleBackedIdentityOperations,
  type GoogleBackedIdentityCredentials,
  type GoogleBackedIdentityError,
} from "./googleBackedIdentityOperations";
import type {
  GoogleBackedIdentityProgress,
  ReportGoogleBackedIdentityProgress,
} from "./googleBackedIdentityProgress";

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
export type GoogleIdentityFlowError = {
  code:
  | "authorization_failed"
  | "cancelled"
  | "signin_failed"
  | "signup_failed"
  | "discovery_failed"
  | "local_save_failed"
  | "homeserver_unavailable"
  | "network_failed"
  | "operation_failed";
  recovery?: {
    googleAccount: GoogleAccountProfile;
    publicIdentity: PubkyPublicIdentity;
  };
};

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
 * Screen-scoped entry points for Google-backed identity work.
 *
 * The flow keeps Google credentials private. Call {@link dispose} when the owning
 * screen unmounts; an operation already past authorization may finish its secure
 * work, but it returns `cancelled` instead of delivering a stale completion.
 */
export interface GoogleIdentityFlow {
  /** Retries preparation after Google authorization could not start. */
  retryAuthorization(): void;

  /** Restores an existing Google-backed identity or creates a missing one. */
  establishIdentity(): Promise<EstablishGoogleIdentityResult>;

  /** Deletes a verified incomplete backup, then creates its replacement. */
  replaceIncompleteIdentity(
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<EstablishGoogleIdentityResult>;

  /** Deletes verified Google backups before removing the local identity. */
  detachIdentity(
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<DetachGoogleIdentityResult>;

  /** Stops authorization, suppresses UI state, and releases owned resources. */
  dispose(): void;
}

type AuthorizedGoogleAccount = {
  credentials: GoogleBackedIdentityCredentials;
  generation: number;
};

/**
 * Owns one screen's Google authorization and identity operation lifecycle.
 *
 * Each public operation first obtains fresh short-lived Google credentials. The
 * credentials stay in this browser object, are passed directly to the concrete
 * Google-backed operation, and never enter UI state. Only one operation may run at
 * a time. Calling {@link dispose} cancels authorization and suppresses later UI
 * updates while allowing already-started cleanup to finish safely.
 */
export class GoogleBackedIdentityFlow implements GoogleIdentityFlow {
  private readonly repository: LocalStorageIdentityRepository;
  private readonly googleAuthorization: GoogleImplicitAuthorization;
  private readonly homegateBaseUrl: string;
  private readonly passportOrigin: string;
  private readonly onState: (state: GoogleIdentityFlowState) => void;
  private operations: GoogleBackedIdentityOperations | undefined;
  private authorizationGeneration = 0;
  private operationPending = false;
  private disposed = false;
  private operationsDisposed = false;

  constructor(input: {
    repository: LocalStorageIdentityRepository;
    googleClientId: string;
    homegateBaseUrl: string;
    passportOrigin: string;
    onState: (state: GoogleIdentityFlowState) => void;
  }) {
    this.repository = input.repository;
    this.googleAuthorization = new GoogleImplicitAuthorization({
      clientId: input.googleClientId,
    });
    this.homegateBaseUrl = input.homegateBaseUrl;
    this.passportOrigin = input.passportOrigin;
    this.onState = input.onState;
  }

  /** Prepares Google authorization and reports whether the flow is ready. */
  start(): void {
    this.prepareAuthorization();
  }

  /** Retries preparation after Google authorization was unavailable. */
  retryAuthorization(): void {
    if (this.disposed || this.operationPending) return;
    this.prepareAuthorization();
  }

  /** Obtains Google access, then restores or creates and activates an identity. */
  async establishIdentity(): Promise<EstablishGoogleIdentityResult> {
    const authorized = await this.requestGoogleCredentials();
    if (Result.isError(authorized)) return Result.err(authorized.error);

    try {
      const established = await this.restoreOrCreateIdentity(authorized.value);
      return this.isCurrent(authorized.value.generation)
        ? established
        : cancelled();
    } catch {
      LOGGER.warn("identity.google.action.failed", {
        operation: "establish",
        code: "unexpected_failure",
      });
      return this.isCurrent(authorized.value.generation)
        ? operationFailure()
        : cancelled();
    } finally {
      this.finishOperation(authorized.value.generation);
    }
  }

  /**
   * Deletes a verified incomplete Drive backup, then creates a replacement using
   * the same freshly authorized Google account.
   */
  async replaceIncompleteIdentity(
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<EstablishGoogleIdentityResult> {
    const authorized = await this.requestGoogleCredentials(expectedGoogleAccountId);
    if (Result.isError(authorized)) return Result.err(authorized.error);

    try {
      this.emit({ status: "establishing", progress: "checking_passport_file" });
      const deleted = await this.getOperations().deleteGoogleIdentityBackups(
        authorized.value.credentials,
        publicIdentity,
        expectedGoogleAccountId,
      );
      if (Result.isError(deleted)) return operationFailure();
      const established = await this.restoreOrCreateIdentity(authorized.value);
      return this.isCurrent(authorized.value.generation)
        ? established
        : cancelled();
    } catch {
      LOGGER.warn("identity.google.action.failed", {
        operation: "replace_incomplete",
        code: "unexpected_failure",
      });
      return this.isCurrent(authorized.value.generation)
        ? operationFailure()
        : cancelled();
    } finally {
      this.finishOperation(authorized.value.generation);
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
      this.emit({ status: "detaching" });
      const deleted = await this.getOperations().deleteGoogleIdentityBackups(
        authorized.value.credentials,
        publicIdentity,
        expectedGoogleAccountId,
      );
      if (Result.isError(deleted)) return operationFailure();

      const removed = this.repository.remove(publicIdentity.publicKeyZ32);
      const result: DetachGoogleIdentityResult = Result.isError(removed)
        ? operationFailure()
        : Result.ok({ deletionStatus: deleted.value.status });
      return this.isCurrent(authorized.value.generation)
        ? result
        : cancelled();
    } catch {
      LOGGER.warn("identity.google.action.failed", {
        operation: "detach",
        code: "unexpected_failure",
      });
      return this.isCurrent(authorized.value.generation)
        ? operationFailure()
        : cancelled();
    } finally {
      this.finishOperation(authorized.value.generation);
    }
  }

  /** Cancels Google authorization and releases Pubky SDK resources owned by this flow. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.authorizationGeneration += 1;
    try {
      this.googleAuthorization.dispose();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "authorization_dispose",
      });
    } finally {
      if (!this.operationPending) this.disposeOperationsOnce();
    }
  }

  private prepareAuthorization(): void {
    try {
      this.googleAuthorization.dispose();
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "authorization_dispose",
      });
    }

    const generation = ++this.authorizationGeneration;
    void this.googleAuthorization.prepare()
      .then((prepared) => {
        if (!this.isCurrent(generation)) return;
        this.emit(Result.isError(prepared)
          ? { status: "authorization-failed" }
          : { status: "ready" });
      })
      .catch(() => {
        if (this.isCurrent(generation)) {
          this.emit({ status: "authorization-failed" });
        }
      });
  }

  private async requestGoogleCredentials(
    expectedGoogleAccountId?: string,
  ): Promise<ResultType<AuthorizedGoogleAccount, GoogleIdentityFlowError>> {
    if (this.disposed) return cancelled();
    if (this.operationPending) return operationFailure();

    const generation = this.authorizationGeneration;
    this.operationPending = true;
    this.emit({ status: "requesting-authorization" });

    try {
      const credentials = await this.googleAuthorization.request(expectedGoogleAccountId);
      if (!this.isCurrent(generation)) {
        this.operationPending = false;
        if (this.disposed) this.disposeOperationsOnce();
        return cancelled();
      }
      if (Result.isError(credentials)
        || (expectedGoogleAccountId !== undefined
          && credentials.value.googleAccount.id !== expectedGoogleAccountId)) {
        this.operationPending = false;
        this.emit({ status: "authorization-failed" });
        return authorizationFailure();
      }
      return Result.ok({ credentials: credentials.value, generation });
    } catch {
      this.operationPending = false;
      this.emit({ status: "authorization-failed" });
      return authorizationFailure();
    }
  }

  private async restoreOrCreateIdentity(
    authorized: AuthorizedGoogleAccount,
  ): Promise<EstablishGoogleIdentityResult> {
    let progressActive = true;
    const reportProgress: ReportGoogleBackedIdentityProgress = (progress) => {
      if (progressActive && this.isCurrent(authorized.generation)) {
        this.emit({ status: "establishing", progress });
      }
    };

    const established = await this.getOperations().restoreOrCreateGoogleBackedIdentity(
      authorized.credentials,
      reportProgress,
    ).finally(() => {
      progressActive = false;
    });
    if (Result.isError(established)) {
      return establishmentFailure(
        established.error,
        authorized.credentials.googleAccount,
      );
    }

    return established.value.establishmentMode === "created"
      ? Result.ok({
        establishmentMode: "created",
        googleAccount: authorized.credentials.googleAccount,
        publicIdentity: established.value.publicIdentity,
        visibleRecoveryCopyStatus: established.value.visibleRecoveryCopyStatus,
      })
      : Result.ok({
        establishmentMode: "restored",
        googleAccount: authorized.credentials.googleAccount,
        publicIdentity: established.value.publicIdentity,
      });
  }

  private finishOperation(generation: number): void {
    this.operationPending = false;
    if (this.isCurrent(generation)) this.emit({ status: "ready" });
    if (this.disposed) this.disposeOperationsOnce();
  }

  private getOperations(): GoogleBackedIdentityOperations {
    this.operations ??= new GoogleBackedIdentityOperations({
      repository: this.repository,
      homegateBaseUrl: this.homegateBaseUrl,
      passportOrigin: this.passportOrigin,
    });
    return this.operations;
  }

  private disposeOperationsOnce(): void {
    if (this.operationsDisposed) return;
    this.operationsDisposed = true;
    try {
      this.operations?.dispose();
      this.operations = undefined;
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "pubky_dispose",
      });
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.authorizationGeneration;
  }

  private emit(state: GoogleIdentityFlowState): void {
    if (this.disposed) return;
    try {
      this.onState(state);
    } catch {
      LOGGER.warn("identity.google.state_listener.failed");
    }
  }
}

function authorizationFailure<Success>(): ResultType<Success, GoogleIdentityFlowError> {
  return Result.err({ code: "authorization_failed" });
}

function cancelled<Success>(): ResultType<Success, GoogleIdentityFlowError> {
  return Result.err({ code: "cancelled" });
}

function operationFailure<Success>(): ResultType<Success, GoogleIdentityFlowError> {
  return Result.err({ code: "operation_failed" });
}

function establishmentFailure(
  error: GoogleBackedIdentityError,
  googleAccount: GoogleAccountProfile,
): EstablishGoogleIdentityResult {
  return Result.err({
    code: establishmentFailureCode(error),
    ...(error.preservedPassportFileIdentity
      ? {
        recovery: {
          googleAccount,
          publicIdentity: error.preservedPassportFileIdentity,
        },
      }
      : {}),
  });
}

function establishmentFailureCode(
  error: GoogleBackedIdentityError,
): Exclude<GoogleIdentityFlowError["code"], "authorization_failed" | "cancelled"> {
  if (error.code === "homeserver_signup_invitation_failed") {
    return error.cause === "homeserver_unavailable" || error.cause === "network_failed"
      ? error.cause
      : "operation_failed";
  }
  return error.code === "signin_failed"
    || error.code === "signup_failed"
    || error.code === "discovery_failed"
    || error.code === "local_save_failed"
    ? error.code
    : "operation_failed";
}
