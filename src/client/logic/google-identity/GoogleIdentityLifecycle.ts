import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { GoogleIdentityCredentials } from "./gia/GoogleImplicitAuthorization";
import type { GoogleIdentityLifecycleError } from "./googleIdentityErrors";
import {
  HomegateClient,
  type HomeserverSignupDetails,
} from "@/client/logic/homegate/HomegateClient";
import {
  PassportFileIdentityLifecycle,
  type IdentityProgress,
  type PassportFileIdentityLifecycleDependencies,
  type StepResult,
} from "@/client/logic/identity-lifecycle/PassportFileIdentityLifecycle";
import { GoogleDrivePassportFileStore } from "@/client/logic/passport-file/google/GoogleDrivePassportFileStore";
import { GoogleDriveVisibleRecoveryCopies } from "@/client/logic/passport-file/google/GoogleDriveVisibleRecoveryCopies";
import type { PassportFileEnvelope } from "@/client/logic/passport-file/passportFileEnvelope";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";

/** Safe setup or restore progress emitted while establishing an identity. */
export type GoogleIdentityProgress = IdentityProgress;

type GoogleIdentityEstablishmentValue =
  | {
      establishmentMode: "created";
      publicIdentity: PubkyPublicIdentity;
      visibleRecoveryCopyStatus: "created" | "unconfirmed" | "skipped";
    }
  | {
      establishmentMode: "restored";
      publicIdentity: PubkyPublicIdentity;
    };

type GoogleIdentityEstablishmentResult = ResultType<
  GoogleIdentityEstablishmentValue,
  GoogleIdentityLifecycleError
>;

type DetachGoogleIdentityResult = ResultType<void, GoogleIdentityLifecycleError>;

type EstablishmentStepResult<Success = void> = ResultType<Success, GoogleIdentityLifecycleError>;

export type DriveStorePort = Pick<
  GoogleDrivePassportFileStore,
  "readPassportFile" | "deleteInvalidPassportFile" | "createPassportFile" | "deletePassportFile"
>;

export type VisibleRecoveryCopiesPort = Pick<
  GoogleDriveVisibleRecoveryCopies,
  "createVisibleRecoveryCopy" | "deleteVisibleRecoveryCopies"
>;

/** Collaborators the lifecycle otherwise constructs itself; every member is optional. */
export type GoogleIdentityLifecycleDependencies = PassportFileIdentityLifecycleDependencies & {
  homegate?: Pick<HomegateClient, "requestGoogleSignupToken">;
  createDriveStore?: (driveAccessToken: string, fetchImpl: typeof fetch) => DriveStorePort;
  createVisibleRecoveryCopies?: (
    driveAccessToken: string,
    fetchImpl: typeof fetch,
  ) => VisibleRecoveryCopiesPort;
};

/**
 * Executes Google-backed identity establishment, repair, and detachment.
 *
 * Unlike `GoogleIdentityController`, this class does not request authorization or own
 * presentation state. It receives fresh credentials from the controller and coordinates Google
 * Drive persistence and the visible recovery copy; key creation, wrapping-key retrieval,
 * cryptography, local storage, and Pubky activation come from {@link PassportFileIdentityLifecycle}.
 *
 * Public asynchronous operations settle with a Result for operational and unexpected failures;
 * they do not intentionally reject. Construction can throw when a required browser dependency or
 * configured endpoint cannot be initialized.
 *
 * Optional `dependencies` replace the collaborators this class otherwise
 * constructs. Production omits them.
 *
 * An injected `pubky` is not disposed if later construction throws. After a
 * successful constructor, {@link dispose} always disposes `this.pubky`.
 */
export class GoogleIdentityLifecycle extends PassportFileIdentityLifecycle {
  private readonly homegate: NonNullable<GoogleIdentityLifecycleDependencies["homegate"]>;
  private readonly createDriveStore: NonNullable<
    GoogleIdentityLifecycleDependencies["createDriveStore"]
  >;
  private readonly createVisibleRecoveryCopies: NonNullable<
    GoogleIdentityLifecycleDependencies["createVisibleRecoveryCopies"]
  >;

  /** @throws {Error} when a required dependency or configured endpoint cannot be initialized. */
  constructor(
    homegateBaseUrl: string,
    passportOrigin: string,
    dependencies: GoogleIdentityLifecycleDependencies = {},
  ) {
    super("google", passportOrigin, dependencies);
    this.createDriveStore =
      dependencies.createDriveStore ??
      ((driveAccessToken, nextFetch) =>
        new GoogleDrivePassportFileStore(driveAccessToken, nextFetch));
    this.createVisibleRecoveryCopies =
      dependencies.createVisibleRecoveryCopies ??
      ((driveAccessToken, nextFetch) =>
        new GoogleDriveVisibleRecoveryCopies(driveAccessToken, nextFetch));
    try {
      this.homegate = dependencies.homegate ?? new HomegateClient(homegateBaseUrl, this.fetch);
    } catch (e) {
      this.releaseOwnedPubkyAfterConstructionFailure();
      throw e;
    }
  }

  /**
   * Restores the Drive identity when present, otherwise creates and activates one.
   * Creation without visible-copy permission pauses until explicitly allowed by the caller.
   * The promise settles with a Result and does not intentionally reject.
   */
  async establishIdentity(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup = false,
  ): Promise<GoogleIdentityEstablishmentResult> {
    return this.restoreOrCreate(credentials, report, allowWithoutVisibleBackup, false);
  }

  /**
   * Deletes the Drive file only when this attempt confirms it still cannot be decrypted for
   * this Google account, then creates a replacement identity. A file that decrypts after all is
   * restored and kept. Resolves the visible-backup decision before deleting anything.
   * The promise settles with a Result and does not intentionally reject.
   */
  async replaceUndecryptablePassportFile(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup = false,
  ): Promise<GoogleIdentityEstablishmentResult> {
    if (!credentials.visibleBackupPermissionGranted && !allowWithoutVisibleBackup) {
      return Result.err({ code: "visible_backup_permission_missing" });
    }
    return this.restoreOrCreate(credentials, report, allowWithoutVisibleBackup, true);
  }

  /**
   * Deletes a confirmed malformed Drive file, then creates or restores current state.
   * Resolves the visible-backup decision before deleting the malformed file.
   * The promise settles with a Result and does not intentionally reject.
   */
  async replaceInvalidPassportFile(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup = false,
  ): Promise<GoogleIdentityEstablishmentResult> {
    if (!credentials.visibleBackupPermissionGranted && !allowWithoutVisibleBackup) {
      return Result.err({ code: "visible_backup_permission_missing" });
    }
    try {
      const store = this.createDriveStore(credentials.driveAccessToken, this.fetch);
      const deleted = await store.deleteInvalidPassportFile();
      if (Result.isError(deleted)) {
        return Result.err({
          code: "invalid_passport_file_delete_failed",
          cause: deleted.error,
        });
      }
      return await this.establishIdentity(credentials, report, allowWithoutVisibleBackup);
    } catch (e) {
      LOGGER.warn("identity.google.invalid_passport_file_replacement.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({
        code: "invalid_passport_file_delete_failed",
        cause: e,
      });
    }
  }

  /**
   * Deletes Google Drive Passport files belonging to the selected identity, then removes
   * the local identity. Any Google Drive failure preserves the local copy.
   * The promise settles with a Result and does not intentionally reject.
   */
  async detachIdentity(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleSubject: string,
  ): Promise<DetachGoogleIdentityResult> {
    if (credentials.googleAccount.googleSubject !== expectedGoogleSubject) {
      LOGGER.warn("identity.google.detach.failed", {
        stage: "account_binding",
        code: "google_account_mismatch",
      });
      return Result.err({ code: "google_account_mismatch" });
    }

    if (!credentials.visibleBackupPermissionGranted) {
      return Result.err({ code: "google_detachment_permission_required" });
    }

    try {
      const deleted = await this.deleteVerifiedGoogleDriveFiles(credentials, publicIdentity);
      if (Result.isError(deleted)) return Result.err(deleted.error);

      const removed = this.repository.remove(publicIdentity.publicKeyZ32);
      return Result.isError(removed)
        ? Result.err({ code: "local_remove_failed", cause: removed.error })
        : Result.ok();
    } catch (e) {
      LOGGER.warn("identity.google.detach.failed", {
        ...safeErrorLogFields(e),
        code: "unexpected_failure",
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /**
   * Restores the found Drive file, otherwise creates a new identity. With
   * `replaceUndecryptableFile`, a file whose decryption fails on this very read is deleted by
   * revision before creation continues, so a file changed meanwhile by another device is never
   * removed.
   */
  private async restoreOrCreate(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup: boolean,
    replaceUndecryptableFile: boolean,
  ): Promise<GoogleIdentityEstablishmentResult> {
    try {
      report({ flow: "lookup", step: "checking" });
      const store = this.createDriveStore(credentials.driveAccessToken, this.fetch);
      LOGGER.info("identity.google.drive_read.started");
      const storedFile = await store.readPassportFile();
      if (Result.isError(storedFile)) {
        return Result.err({
          code:
            storedFile.error.code === "invalid_file"
              ? "invalid_passport_file"
              : "drive_read_failed",
          cause: storedFile.error,
        });
      }

      if (storedFile.value.status === "found") {
        LOGGER.info("identity.google.drive_read.completed", { status: "found" });
        const wrappingKey = await this.requestWrappingKey(
          credentials.googleIdToken,
          storedFile.value.envelope,
        );
        if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
        const restored = await this.restoreIdentity({
          account: { googleAccount: credentials.googleAccount },
          envelope: storedFile.value.envelope,
          wrappingKey: wrappingKey.value.wrappingKey,
          report,
          requestSignupToken: () => this.requestSignupToken(credentials.googleIdToken),
        });
        const undecryptable = Result.isError(restored) && restored.error.code === "decrypt_failed";
        if (!replaceUndecryptableFile || !undecryptable) {
          return Result.isError(restored)
            ? Result.err(restored.error)
            : Result.ok({
                establishmentMode: "restored",
                publicIdentity: restored.value.publicIdentity,
              });
        }

        LOGGER.info("identity.google.undecryptable_passport_file_delete.started");
        const deleted = await store.deletePassportFile(storedFile.value.reference);
        if (Result.isError(deleted)) {
          return Result.err({
            code: "undecryptable_passport_file_delete_failed",
            cause: deleted.error,
          });
        }
        LOGGER.info("identity.google.undecryptable_passport_file_delete.completed");
      } else {
        LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
      }

      if (!credentials.visibleBackupPermissionGranted && !allowWithoutVisibleBackup) {
        return Result.err({ code: "visible_backup_permission_missing" });
      }
      report({ flow: "create", step: "preparing" });
      const wrappingKey = await this.requestWrappingKey(credentials.googleIdToken);
      if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
      const signupDetails = await this.requestSignupToken(credentials.googleIdToken);
      if (Result.isError(signupDetails)) return Result.err(signupDetails.error);

      report({ flow: "create", step: "creating" });
      const visibleCopies = credentials.visibleBackupPermissionGranted
        ? this.createVisibleRecoveryCopies(credentials.driveAccessToken, this.fetch)
        : undefined;
      return await this.createGoogleIdentity(
        credentials,
        signupDetails.value,
        wrappingKey.value.wrappingKey,
        wrappingKey.value.keyId,
        report,
        store,
        visibleCopies,
      );
    } catch (e) {
      LOGGER.warn("identity.google.restore_or_create.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /**
   * Creates the encrypted Drive file before attempting homeserver activation. Once
   * that authoritative file exists it is preserved on every later failure. The visible
   * recovery copy uploads while the homeserver work runs; it is never on the activation path.
   */
  private async createGoogleIdentity(
    credentials: GoogleIdentityCredentials,
    signupDetails: HomeserverSignupDetails,
    wrappingKey: string,
    keyId: string,
    report: (progress: GoogleIdentityProgress) => void,
    store: DriveStorePort,
    visibleCopies: VisibleRecoveryCopiesPort | undefined,
  ): Promise<GoogleIdentityEstablishmentResult> {
    let visibleCopy: Promise<boolean> | undefined;
    const created = await this.createIdentity({
      account: { googleAccount: credentials.googleAccount },
      signupDetails,
      wrappingKey,
      keyId,
      report,
      persist: async (envelope): Promise<EstablishmentStepResult> => {
        LOGGER.info("identity.google.operational_drive_write.started");
        const written = await store.createPassportFile(envelope);
        if (Result.isError(written)) {
          return Result.err({
            code:
              written.error.code === "create_conflict"
                ? "drive_create_conflict"
                : "drive_write_failed",
            cause: written.error,
          });
        }
        LOGGER.info("identity.google.operational_drive_write.completed");
        return Result.ok();
      },
      onPersisted: (envelope, publicIdentity) => {
        if (!visibleCopies) return;
        LOGGER.info("identity.google.visible_recovery_copy.started");
        visibleCopy = this.createVisibleRecoveryCopy(visibleCopies, envelope, publicIdentity);
      },
    });
    if (Result.isError(created)) return Result.err(created.error);

    const visibleRecoveryCopyStatus = await this.settleVisibleRecoveryCopy(visibleCopy);
    LOGGER.info("identity.google.create.completed", { visibleRecoveryCopyStatus });
    return Result.ok({
      establishmentMode: "created",
      publicIdentity: created.value.publicIdentity,
      visibleRecoveryCopyStatus,
    });
  }

  private async settleVisibleRecoveryCopy(
    visibleCopy: Promise<boolean> | undefined,
  ): Promise<"created" | "unconfirmed" | "skipped"> {
    let status: "created" | "unconfirmed" | "skipped" = "skipped";
    if (visibleCopy) {
      status = (await visibleCopy) ? "created" : "unconfirmed";
      if (status === "unconfirmed") {
        LOGGER.warn("identity.google.visible_recovery_copy.unconfirmed", {
          activationCompleted: true,
        });
      }
    }
    LOGGER.info("identity.google.visible_recovery_copy.completed", { status });
    return status;
  }

  private async requestSignupToken(
    googleIdToken: string,
  ): Promise<StepResult<HomeserverSignupDetails>> {
    LOGGER.info("identity.google.homeserver_signup_token.started");
    const signupDetails = await this.homegate.requestGoogleSignupToken(googleIdToken);
    if (Result.isError(signupDetails)) {
      return Result.err({
        code: "homeserver_signup_token_failed",
        detailCode: signupDetails.error.code,
        cause: signupDetails.error,
      });
    }
    LOGGER.info("identity.google.homeserver_signup_token.completed");
    return Result.ok(signupDetails.value);
  }

  private async deleteVerifiedGoogleDriveFiles(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<DetachGoogleIdentityResult> {
    const store = this.createDriveStore(credentials.driveAccessToken, this.fetch);
    const storedFile = await store.readPassportFile();
    if (Result.isError(storedFile)) {
      return Result.err({ code: "google_drive_cleanup_failed", cause: storedFile.error });
    }

    if (storedFile.value.status === "found") {
      const wrappingKey = await this.wrappingKeys.requestWrappingKey(
        credentials.googleIdToken,
        storedFile.value.envelope.keyId,
      );
      if (Result.isError(wrappingKey)) {
        return Result.err({ code: "google_drive_cleanup_failed", cause: wrappingKey.error });
      }
      const restored = await this.restoreKey(
        storedFile.value.envelope,
        wrappingKey.value.wrappingKey,
      );
      if (Result.isError(restored)) {
        return Result.err({ code: "google_drive_cleanup_failed", cause: restored.error });
      }
      try {
        if (restored.value.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32) {
          LOGGER.warn("identity.google.delete.failed", {
            stage: "identity_validation",
            code: "identity_mismatch",
          });
          return Result.err({ code: "google_drive_cleanup_failed" });
        }
      } finally {
        this.disposeIdentityKey(restored.value, "deleted_key_dispose");
      }
    }

    const visibleCopies = this.createVisibleRecoveryCopies(
      credentials.driveAccessToken,
      this.fetch,
    );
    const deletedVisibleCopies = await visibleCopies.deleteVisibleRecoveryCopies(publicIdentity);
    if (Result.isError(deletedVisibleCopies)) {
      return Result.err({ code: "google_drive_cleanup_failed", cause: deletedVisibleCopies.error });
    }
    if (storedFile.value.status === "missing") return Result.ok();

    const deleted = await store.deletePassportFile(storedFile.value.reference);
    return Result.isError(deleted)
      ? Result.err({ code: "google_drive_cleanup_failed", cause: deleted.error })
      : Result.ok();
  }

  private async createVisibleRecoveryCopy(
    visibleCopies: VisibleRecoveryCopiesPort,
    envelope: PassportFileEnvelope,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      let finishTimeout!: () => void;
      const deadline = new Promise<undefined>((resolve) => {
        finishTimeout = () => resolve(undefined);
      });
      timeout = setTimeout(() => {
        controller.abort();
        finishTimeout();
      }, REQUEST_TIMEOUT_MS);
      const result = await Promise.race([
        visibleCopies.createVisibleRecoveryCopy(envelope, publicIdentity, controller.signal),
        deadline,
      ]);
      if (result === undefined) return false;
      if (Result.isOk(result)) return true;
      LOGGER.warn("identity.google.visible_recovery_copy.failed", {
        stage: "create",
        code: result.error.code,
        ...safeErrorLogFields(result.error),
      });
      return false;
    } catch (e) {
      LOGGER.warn("identity.google.visible_recovery_copy.failed", {
        stage: "create",
        ...safeErrorLogFields(e),
      });
      return false;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
