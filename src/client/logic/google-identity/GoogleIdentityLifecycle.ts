import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleAccountProfile } from "../../../libs/googleAccountProfile";
import { LOGGER, safeErrorLogFields } from "../../../libs/logger/logger";
import { NETWORK_OPERATION_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from "../../../libs/passportPolicy";
import type { CodedFailure } from "../../../libs/result";
import type { GoogleIdentityCredentials } from "./gia/GoogleImplicitAuthorization";
import {
  HomegateClient,
  type HomegateSignupTokenErrorCode,
  type HomeserverSignupDetails,
} from "../homegate/HomegateClient";
import { GoogleDrivePassportFileStore } from "../passport-file/google/GoogleDrivePassportFileStore";
import { GoogleDriveVisibleRecoveryCopies } from "../passport-file/google/GoogleDriveVisibleRecoveryCopies";
import type { PassportFileEnvelope } from "../passport-file/passportFileEnvelope";
import { PassportFileWebCrypto } from "../passport-file/PassportFileWebCrypto";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
  type PubkyPublicIdentity,
} from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../pubky/PubkySdkAdapter";
import {
  GoogleWrappingKeyApiClient,
  type GoogleWrappingKeyErrorCode,
} from "../wrapping-key/GoogleWrappingKeyApiClient";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";

/** Safe setup or restore progress emitted while establishing an identity. */
export type GoogleIdentityProgress =
  | { flow: "lookup"; step: "checking" }
  | {
      flow: "create";
      step:
        | "preparing"
        | "creating"
        | "storing_passport_file"
        | "signing_up"
        | "publishing"
        | "activating";
    }
  | { flow: "restore"; step: "restoring" | "signing_in" }
  | { flow: "repair"; step: "signing_up" | "publishing" | "signing_in" };

type GoogleIdentityEstablishmentValue =
  | {
      establishmentMode: "created";
      publicIdentity: PubkyPublicIdentity;
      visibleRecoveryCopyStatus: "created" | "unconfirmed";
    }
  | {
      establishmentMode: "restored";
      publicIdentity: PubkyPublicIdentity;
    };

type GoogleIdentityEstablishmentError =
  | {
      code: "wrapping_key_failed";
      detailCode: GoogleWrappingKeyErrorCode;
      cause?: unknown;
    }
  | {
      code: "homeserver_signup_token_failed";
      detailCode: HomegateSignupTokenErrorCode;
      cause?: unknown;
    }
  | CodedFailure<
      | "create_failed"
      | "decrypt_failed"
      | "publication_failed"
      | "drive_create_conflict"
      | "invalid_passport_file"
      | "invalid_passport_file_delete_failed"
      | "drive_read_failed"
      | "drive_write_failed"
      | "encrypt_failed"
      | "identity_mismatch"
      | "local_save_failed"
      | "restore_failed"
      | "signin_failed"
      | "signup_failed"
      | "unexpected_failure"
    >;

type GoogleIdentityEstablishmentResult = ResultType<
  GoogleIdentityEstablishmentValue,
  GoogleIdentityEstablishmentError
>;

type DetachGoogleIdentityError = CodedFailure<
  | "google_account_mismatch"
  | "google_drive_cleanup_failed"
  | "local_remove_failed"
  | "unexpected_failure"
>;

export type GoogleIdentityLifecycleError =
  GoogleIdentityEstablishmentError | DetachGoogleIdentityError;

type DetachGoogleIdentityResult = ResultType<void, DetachGoogleIdentityError>;

type EstablishmentStepResult<Success = void> = ResultType<
  Success,
  GoogleIdentityEstablishmentError
>;

/**
 * Executes Google-backed identity establishment, repair, and detachment.
 *
 * Unlike `GoogleIdentityController`, this class does not request authorization or own
 * presentation state. It receives fresh credentials from the controller and coordinates Google
 * Drive persistence, wrapping-key retrieval, Homegate signup, cryptography, local storage, and
 * Pubky activation.
 *
 * Public asynchronous operations settle with a Result for operational and unexpected failures;
 * they do not intentionally reject. Construction can throw when a required browser dependency or
 * configured endpoint cannot be initialized.
 */
export class GoogleIdentityLifecycle {
  private readonly repository = new LocalStorageIdentityRepository();
  private readonly pubky: PubkySdkAdapter;
  private readonly wrappingKeys: GoogleWrappingKeyApiClient;
  private readonly homegate: HomegateClient;
  private readonly crypto: PassportFileWebCrypto;
  private readonly requests = new AbortController();
  private readonly fetch: typeof fetch = (request, init) => {
    const signals = [this.requests.signal, AbortSignal.timeout(NETWORK_OPERATION_TIMEOUT_MS)];
    if (init?.signal) signals.push(init.signal);
    return globalThis.fetch(request, { ...init, signal: AbortSignal.any(signals) });
  };
  private disposed = false;

  /** @throws {Error} when a required dependency or configured endpoint cannot be initialized. */
  constructor(
    homegateBaseUrl: string,
    private readonly passportOrigin: string,
  ) {
    this.pubky = new PubkySdkAdapter();
    try {
      this.wrappingKeys = new GoogleWrappingKeyApiClient(this.fetch);
      this.homegate = new HomegateClient(homegateBaseUrl, this.fetch);
      this.crypto = new PassportFileWebCrypto();
    } catch (e) {
      try {
        this.pubky.dispose();
      } catch (e) {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: "construction_pubky_dispose",
          ...safeErrorLogFields(e),
        });
      }
      throw e;
    }
  }

  /**
   * Restores the Drive identity when present, otherwise creates and activates one.
   * The promise settles with a Result and does not intentionally reject.
   */
  async establishIdentity(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
  ): Promise<GoogleIdentityEstablishmentResult> {
    try {
      report({ flow: "lookup", step: "checking" });
      const store = new GoogleDrivePassportFileStore(credentials.driveAccessToken, this.fetch);
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
        return await this.restoreIdentity(
          credentials,
          storedFile.value.envelope,
          wrappingKey.value.wrappingKey,
          report,
        );
      }

      LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
      report({ flow: "create", step: "preparing" });
      const wrappingKey = await this.requestWrappingKey(credentials.googleIdToken);
      if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
      const signupDetails = await this.requestSignupToken(credentials.googleIdToken);
      if (Result.isError(signupDetails)) return Result.err(signupDetails.error);

      report({ flow: "create", step: "creating" });
      const visibleCopies = new GoogleDriveVisibleRecoveryCopies(
        credentials.driveAccessToken,
        this.fetch,
      );
      return await this.createIdentity(
        credentials.googleAccount,
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
   * Deletes a confirmed malformed Drive file, then creates or restores current state.
   * The promise settles with a Result and does not intentionally reject.
   */
  async replaceInvalidPassportFile(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
  ): Promise<GoogleIdentityEstablishmentResult> {
    try {
      const store = new GoogleDrivePassportFileStore(credentials.driveAccessToken, this.fetch);
      const deleted = await store.deleteInvalidPassportFile();
      if (Result.isError(deleted)) {
        return Result.err({
          code: "invalid_passport_file_delete_failed",
          cause: deleted.error,
        });
      }
      return await this.establishIdentity(credentials, report);
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

    try {
      const deleted = await this.deleteVerifiedGoogleDriveFiles(credentials, publicIdentity);
      if (Result.isError(deleted)) return Result.err(deleted.error);

      const removed = this.repository.remove(publicIdentity.publicKeyZ32);
      return Result.isError(removed)
        ? Result.err({ code: "local_remove_failed", cause: removed.error })
        : Result.ok();
    } catch (e) {
      LOGGER.warn("identity.google.detach.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /** Aborts browser requests without freeing key handles that may still be in use. */
  abortRequests(): void {
    this.requests.abort();
  }

  /** Releases all SDK key material owned by this screen-scoped operation object. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortRequests();
    this.pubky.dispose();
  }

  /**
   * Creates the encrypted Drive file before attempting homeserver activation. Once
   * that authoritative file exists it is preserved on every later failure.
   */
  private async createIdentity(
    googleAccount: GoogleAccountProfile,
    signupDetails: HomeserverSignupDetails,
    wrappingKey: string,
    keyId: string,
    report: (progress: GoogleIdentityProgress) => void,
    store: GoogleDrivePassportFileStore,
    visibleCopies: GoogleDriveVisibleRecoveryCopies,
  ): Promise<GoogleIdentityEstablishmentResult> {
    LOGGER.info("identity.google.create.started");
    LOGGER.info("identity.google.create_key.started");
    const created = await this.pubky.createIdentityKey();
    if (Result.isError(created)) {
      return Result.err({ code: "create_failed", cause: created.error });
    }
    LOGGER.info("identity.google.create_key.completed");

    try {
      const secretKey = await this.pubky.exportSecretKey(created.value.keyHandle);
      if (Result.isError(secretKey)) {
        return Result.err({ code: "create_failed", cause: secretKey.error });
      }

      let visibleRecoveryCopyStatus: "created" | "unconfirmed" = "created";
      report({ flow: "create", step: "storing_passport_file" });
      LOGGER.info("identity.google.encrypt.started");
      const encrypted = await this.crypto
        .encryptSecretKeyBytes(secretKey.value.bytes, wrappingKey, this.passportOrigin, keyId)
        .finally(() => {
          secretKey.value.bytes.fill(0);
        });
      if (Result.isError(encrypted)) {
        return Result.err({ code: "encrypt_failed", cause: encrypted.error });
      }
      const envelope = encrypted.value;
      LOGGER.info("identity.google.encrypt.completed");

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

      LOGGER.info("identity.google.visible_recovery_copy.started");
      const visibleCopyConfirmed = await this.createVisibleRecoveryCopy(
        visibleCopies,
        envelope,
        created.value.publicIdentity,
      );
      if (!visibleCopyConfirmed) {
        visibleRecoveryCopyStatus = "unconfirmed";
        LOGGER.warn("identity.google.visible_recovery_copy.unconfirmed", {
          activationContinues: true,
        });
      }
      LOGGER.info("identity.google.visible_recovery_copy.completed", {
        status: visibleRecoveryCopyStatus,
      });

      const activated = await this.signupAndActivate(
        created.value,
        signupDetails,
        googleAccount,
        report,
      );
      if (Result.isError(activated)) return Result.err(activated.error);

      LOGGER.info("identity.google.create.completed", { visibleRecoveryCopyStatus });
      return Result.ok({
        establishmentMode: "created",
        publicIdentity: created.value.publicIdentity,
        visibleRecoveryCopyStatus,
      });
    } finally {
      this.disposeIdentityKey(created.value, "created_key_dispose");
    }
  }

  /**
   * Restores one identity and signs in normally before attempting PKDNS and
   * homeserver repair for an interrupted setup.
   */
  private async restoreIdentity(
    credentials: GoogleIdentityCredentials,
    envelope: PassportFileEnvelope,
    wrappingKey: string,
    report: (progress: GoogleIdentityProgress) => void,
  ): Promise<GoogleIdentityEstablishmentResult> {
    report({ flow: "restore", step: "restoring" });
    const restored = await this.restoreKey(envelope, wrappingKey);
    if (Result.isError(restored)) return Result.err(restored.error);

    try {
      report({ flow: "restore", step: "signing_in" });
      const signedIn = await this.pubky.signin(restored.value.keyHandle, "normal");
      if (!Result.isError(signedIn)) {
        const verified = this.verifySessionIdentity(restored.value, signedIn.value.publicIdentity);
        if (Result.isError(verified)) return Result.err(verified.error);
        const saved = await this.saveIdentity(
          restored.value,
          credentials.googleAccount,
          "restored",
        );
        if (Result.isError(saved)) return Result.err(saved.error);
        return Result.ok({
          establishmentMode: "restored",
          publicIdentity: restored.value.publicIdentity,
        });
      }

      const homeserver = await this.pubky.resolveHomeserver(
        restored.value.publicIdentity.publicKeyZ32,
      );
      if (Result.isError(homeserver)) {
        return Result.err({ code: "signin_failed", cause: homeserver.error });
      }
      if (homeserver.value !== null) {
        return Result.err({ code: "signin_failed", cause: signedIn.error });
      }

      report({ flow: "repair", step: "signing_up" });
      const signupDetails = await this.requestSignupToken(credentials.googleIdToken);
      if (Result.isError(signupDetails)) return Result.err(signupDetails.error);
      const activated = await this.signupAndActivate(
        restored.value,
        signupDetails.value,
        credentials.googleAccount,
        report,
        true,
      );
      if (Result.isError(activated)) return Result.err(activated.error);
      return Result.ok({
        establishmentMode: "restored",
        publicIdentity: restored.value.publicIdentity,
      });
    } finally {
      this.disposeIdentityKey(restored.value, "restored_key_dispose");
    }
  }

  /** Decrypts exactly 32 secret bytes; the Pubky adapter consumes and clears them during restoration. */
  private async restoreKey(
    envelope: PassportFileEnvelope,
    wrappingKey: string,
  ): Promise<EstablishmentStepResult<PubkyIdentityKey>> {
    LOGGER.info("identity.google.decrypt.started");
    const secretKey = await this.crypto.decryptSecretKeyBytes(
      envelope,
      wrappingKey,
      this.passportOrigin,
    );
    if (Result.isError(secretKey)) {
      return Result.err({ code: "decrypt_failed", cause: secretKey.error });
    }

    const restored = await this.pubky.restoreIdentityKey({
      bytes: secretKey.value,
      format: PUBKY_SECRET_KEY_FORMAT,
    });
    if (Result.isError(restored)) {
      return Result.err({ code: "restore_failed", cause: restored.error });
    }
    LOGGER.info("identity.google.restore.completed");
    return Result.ok(restored.value);
  }

  /**
   * Shared activation for new and interrupted identities. Signup conflict means the
   * account already exists. Ambiguous signup or publication failures are verified
   * through blocking sign-in before they are treated as fatal.
   */
  private async signupAndActivate(
    identity: PubkyIdentityKey,
    signupDetails: HomeserverSignupDetails,
    googleAccount: GoogleAccountProfile,
    report: (progress: GoogleIdentityProgress) => void,
    isReconciliation = false,
  ): Promise<EstablishmentStepResult> {
    if (!isReconciliation) report({ flow: "create", step: "signing_up" });
    LOGGER.info("identity.google.signup.started");
    const signedUp = await this.pubky.signup(
      identity.keyHandle,
      signupDetails.homeserverPubky,
      signupDetails.signupToken,
    );
    if (
      Result.isError(signedUp) &&
      signedUp.error.code !== "account_exists" &&
      signedUp.error.code !== "signup_uncertain"
    ) {
      return Result.err({ code: "signup_failed", cause: signedUp.error });
    }
    const signupWasUncertain =
      Result.isError(signedUp) && signedUp.error.code === "signup_uncertain";
    LOGGER.info("identity.google.signup.completed", {
      status: Result.isError(signedUp) ? signedUp.error.code : "created",
    });

    report(
      isReconciliation
        ? { flow: "repair", step: "publishing" }
        : { flow: "create", step: "publishing" },
    );
    LOGGER.info("identity.google.publication.started");
    const published = await this.pubky.publishHomeserver(
      identity.keyHandle,
      signupDetails.homeserverPubky,
    );
    if (Result.isError(published) && published.error.code !== "publish_failed") {
      return Result.err({ code: "publication_failed", cause: published.error });
    }
    const publicationWasUncertain = Result.isError(published);
    if (!publicationWasUncertain) LOGGER.info("identity.google.publication.completed");

    report(
      isReconciliation
        ? { flow: "repair", step: "signing_in" }
        : { flow: "create", step: "activating" },
    );
    const signedIn = await this.pubky.signin(identity.keyHandle, "after-publication");
    if (Result.isError(signedIn)) {
      return Result.err({
        code: signupWasUncertain
          ? "signup_failed"
          : publicationWasUncertain
            ? "publication_failed"
            : "signin_failed",
        cause: signedIn.error,
      });
    }
    const verified = this.verifySessionIdentity(identity, signedIn.value.publicIdentity);
    if (Result.isError(verified)) return Result.err(verified.error);
    return this.saveIdentity(identity, googleAccount, "homeserver_signup");
  }

  private verifySessionIdentity(
    identity: PubkyIdentityKey,
    sessionIdentity: PubkyPublicIdentity,
  ): EstablishmentStepResult {
    if (sessionIdentity.publicKeyZ32 === identity.publicIdentity.publicKeyZ32) {
      return Result.ok();
    }
    LOGGER.warn("identity.google.activation_identity.failed");
    return Result.err({ code: "identity_mismatch" });
  }

  private async saveIdentity(
    identity: PubkyIdentityKey,
    googleAccount: GoogleAccountProfile,
    activation: "homeserver_signup" | "restored",
  ): Promise<EstablishmentStepResult> {
    LOGGER.info("identity.local_save.started", { activation });
    const secretKey = await this.pubky.exportSecretKey(identity.keyHandle);
    if (Result.isError(secretKey)) {
      return Result.err({ code: "local_save_failed", cause: secretKey.error });
    }
    try {
      const saved = this.repository.save(
        {
          publicIdentity: identity.publicIdentity,
          googleAccount,
        },
        secretKey.value,
      );
      if (Result.isError(saved)) {
        return Result.err({ code: "local_save_failed", cause: saved.error });
      }
      LOGGER.info("identity.local_save.completed", { activation });
      return Result.ok();
    } finally {
      secretKey.value.bytes.fill(0);
    }
  }

  private async requestSignupToken(
    googleIdToken: string,
  ): Promise<EstablishmentStepResult<HomeserverSignupDetails>> {
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

  private async requestWrappingKey(
    googleIdToken: string,
    envelope?: PassportFileEnvelope,
  ): Promise<EstablishmentStepResult<{ wrappingKey: string; keyId: string }>> {
    LOGGER.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.wrappingKeys.requestGoogleWrappingKey(
      googleIdToken,
      envelope?.keyId,
    );
    if (Result.isError(wrappingKey)) {
      return Result.err({
        code: "wrapping_key_failed",
        detailCode: wrappingKey.error.code,
        cause: wrappingKey.error,
      });
    }
    LOGGER.info("identity.google.wrapping_key.completed");
    return Result.ok(wrappingKey.value);
  }

  private async deleteVerifiedGoogleDriveFiles(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<DetachGoogleIdentityResult> {
    const store = new GoogleDrivePassportFileStore(credentials.driveAccessToken, this.fetch);
    const storedFile = await store.readPassportFile();
    if (Result.isError(storedFile)) {
      return Result.err({ code: "google_drive_cleanup_failed", cause: storedFile.error });
    }

    if (storedFile.value.status === "found") {
      const wrappingKey = await this.wrappingKeys.requestGoogleWrappingKey(
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

    const visibleCopies = new GoogleDriveVisibleRecoveryCopies(
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
    visibleCopies: GoogleDriveVisibleRecoveryCopies,
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

  private disposeIdentityKey(
    identity: PubkyIdentityKey,
    operation: "created_key_dispose" | "restored_key_dispose" | "deleted_key_dispose",
  ): void {
    try {
      this.pubky.disposeIdentityKey(identity.keyHandle);
    } catch (e) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation,
        ...safeErrorLogFields(e),
      });
    }
  }
}
