import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type {
  GoogleAccountProfile,
} from "../local-identity/localIdentityModels";
import type { GoogleIdentityCredentials } from "./GoogleImplicitAuthorization";
import {
  HomegateClient,
  type HomegateSignupInvitationErrorCode,
  type HomeserverSignupInvitation,
} from "../homegate/HomegateClient";
import { GoogleDrivePassportFileStore } from "../passport-file/google/GoogleDrivePassportFileStore";
import { GoogleDriveVisibleRecoveryCopies } from "../passport-file/google/GoogleDriveVisibleRecoveryCopies";
import type { PassportFileEnvelopeV1 } from "../passport-file/passportFileEnvelope";
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
    step: "preparing" | "creating" | "storing_passport_file" | "signing_up" | "publishing" | "activating";
  }
  | { flow: "restore"; step: "restoring" | "signing_in" }
  | { flow: "repair"; step: "signing_up" | "publishing" | "signing_in" };

const VISIBLE_RECOVERY_COPY_TIMEOUT_MS = 10_000;
const NETWORK_REQUEST_TIMEOUT_MS = 30_000;

export type GoogleIdentityOperationValue =
  | {
    establishmentMode: "created";
    publicIdentity: PubkyPublicIdentity;
    visibleRecoveryCopyStatus: "created" | "unconfirmed";
  }
  | {
    establishmentMode: "restored";
    publicIdentity: PubkyPublicIdentity;
  };

type GoogleIdentityFailureCode =
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
  | "unexpected_failure";

type GoogleIdentityEstablishmentError =
  | { code: "wrapping_key_failed"; cause: GoogleWrappingKeyErrorCode }
  | { code: "homeserver_signup_invitation_failed"; cause: HomegateSignupInvitationErrorCode }
  | { code: GoogleIdentityFailureCode };

type GoogleIdentityOperationResult = ResultType<
  GoogleIdentityOperationValue,
  GoogleIdentityEstablishmentError
>;

type DetachGoogleIdentityError = {
  code: "google_drive_cleanup_failed" | "local_remove_failed" | "unexpected_failure";
};

export type GoogleIdentityOperationError =
  | GoogleIdentityEstablishmentError
  | DetachGoogleIdentityError;

type DetachGoogleIdentityResult = ResultType<
  { deletionStatus: "deleted" | "missing" },
  DetachGoogleIdentityError
>;

type OperationResult<Success = void> = ResultType<Success, GoogleIdentityEstablishmentError>;

/**
 * Manages the complete Google-backed Pubky identity lifecycle for one screen.
 */
export class GoogleIdentityOperations {
  private pubky: PubkySdkAdapter;
  private wrappingKeys: GoogleWrappingKeyApiClient;
  private homegate: HomegateClient;
  private crypto: PassportFileWebCrypto;
  private requests = new AbortController();
  private fetch: typeof fetch = (request, init) => {
    const signals = [this.requests.signal, AbortSignal.timeout(NETWORK_REQUEST_TIMEOUT_MS)];
    if (init?.signal) signals.push(init.signal);
    return globalThis.fetch(request, { ...init, signal: AbortSignal.any(signals) });
  };
  private disposed = false;

  constructor(
    private repository: LocalStorageIdentityRepository,
    homegateBaseUrl: string,
    private passportOrigin: string,
  ) {
    const pubky = new PubkySdkAdapter();
    this.pubky = pubky;
    try {
      this.wrappingKeys = new GoogleWrappingKeyApiClient(this.fetch);
      this.homegate = new HomegateClient(homegateBaseUrl, this.fetch);
      this.crypto = new PassportFileWebCrypto();
    } catch (error) {
      try {
        pubky.dispose();
      } catch {
        LOGGER.warn("identity.google.cleanup.failed", { operation: "construction_pubky_dispose" });
      }
      throw error;
    }
  }

  /** Restores the Drive identity when present, otherwise creates and activates one. */
  async establishIdentity(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
  ): Promise<GoogleIdentityOperationResult> {
    try {
      report({ flow: "lookup", step: "checking" });
      const store = new GoogleDrivePassportFileStore(credentials.driveAccessToken, this.fetch);
      LOGGER.info("identity.google.drive_read.started");
      const storedFile = await store.readPassportFile();
      if (Result.isError(storedFile)) {
        return Result.err({
          code: storedFile.error.code === "invalid_file"
            ? "invalid_passport_file"
            : "drive_read_failed",
        });
      }

      if (storedFile.value.status === "found") {
        LOGGER.info("identity.google.drive_read.completed", { status: "found" });
        const wrappingKey = await this.requestWrappingKey(credentials.googleIdToken);
        if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
        return this.restoreIdentity(credentials, storedFile.value.envelope, wrappingKey.value, report);
      }

      LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
      report({ flow: "create", step: "preparing" });
      const wrappingKey = await this.requestWrappingKey(credentials.googleIdToken);
      if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
      const invitation = await this.requestSignupInvitation(credentials.googleIdToken);
      if (Result.isError(invitation)) return Result.err(invitation.error);

      report({ flow: "create", step: "creating" });
      const visibleCopies = new GoogleDriveVisibleRecoveryCopies(
        credentials.driveAccessToken,
        this.fetch,
      );
      return this.createIdentity(
        credentials.googleAccount,
        invitation.value,
        wrappingKey.value,
        report,
        store,
        visibleCopies,
      );
    } catch {
      LOGGER.warn("identity.google.restore_or_create.failed", { code: "unexpected_failure" });
      return Result.err({ code: "unexpected_failure" });
    }
  }

  /** Deletes a confirmed malformed Drive file, then creates or restores current state. */
  async replaceInvalidPassportFile(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
  ): Promise<GoogleIdentityOperationResult> {
    try {
      const store = new GoogleDrivePassportFileStore(credentials.driveAccessToken, this.fetch);
      const deleted = await store.deleteInvalidPassportFile();
      if (Result.isError(deleted)) {
        return Result.err({ code: "invalid_passport_file_delete_failed" });
      }
      return this.establishIdentity(credentials, report);
    } catch {
      LOGGER.warn("identity.google.invalid_passport_file_replacement.failed", {
        code: "unexpected_failure",
      });
      return Result.err({ code: "invalid_passport_file_delete_failed" });
    }
  }

  /**
   * Deletes Google Drive Passport files belonging to the selected identity, then removes
   * the local identity. Any Google Drive failure preserves the local copy.
   */
  async detachIdentity(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleSubject: string,
  ): Promise<DetachGoogleIdentityResult> {
    if (credentials.googleAccount.googleSubject !== expectedGoogleSubject) {
      return Result.err({ code: "google_drive_cleanup_failed" });
    }

    try {
      const deleted = await this.deleteVerifiedGoogleDriveFiles(credentials, publicIdentity);
      if (deleted === null) return Result.err({ code: "google_drive_cleanup_failed" });

      const removed = this.repository.remove(publicIdentity.publicKeyZ32);
      return Result.isError(removed)
        ? Result.err({ code: "local_remove_failed" })
        : Result.ok({ deletionStatus: deleted });
    } catch {
      LOGGER.warn("identity.google.detach.failed", { code: "unexpected_failure" });
      return Result.err({ code: "unexpected_failure" });
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
    invitation: HomeserverSignupInvitation,
    wrappingKey: string,
    report: (progress: GoogleIdentityProgress) => void,
    store: GoogleDrivePassportFileStore,
    visibleCopies: GoogleDriveVisibleRecoveryCopies,
  ): Promise<GoogleIdentityOperationResult> {
    LOGGER.info("identity.google.create.started");
    LOGGER.info("identity.google.create_key.started");
    const created = await this.pubky.createIdentityKey();
    if (Result.isError(created)) return Result.err({ code: "create_failed" });
    LOGGER.info("identity.google.create_key.completed");

    try {
      const secretKey = await this.pubky.exportSecretKey(created.value.keyHandle);
      if (Result.isError(secretKey)) return Result.err({ code: "create_failed" });

      let visibleRecoveryCopyStatus: "created" | "unconfirmed" = "created";
      report({ flow: "create", step: "storing_passport_file" });
      LOGGER.info("identity.google.encrypt.started");
      const encrypted = await this.crypto.encryptSecretKeyBytes(
        secretKey.value.bytes,
        wrappingKey,
        this.passportOrigin,
      ).finally(() => {
        secretKey.value.bytes.fill(0);
      });
      if (Result.isError(encrypted)) return Result.err({ code: "encrypt_failed" });
      const envelope = encrypted.value;
      LOGGER.info("identity.google.encrypt.completed");

      LOGGER.info("identity.google.operational_drive_write.started");
      const written = await store.createPassportFile(envelope);
      if (Result.isError(written)) {
        return Result.err({
          code: written.error.code === "create_conflict"
            ? "drive_create_conflict"
            : "drive_write_failed",
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
        LOGGER.warn("identity.google.visible_recovery_copy.unconfirmed", { activationContinues: true });
      }
      LOGGER.info("identity.google.visible_recovery_copy.completed", { status: visibleRecoveryCopyStatus });

      const activated = await this.signupAndActivate(
        created.value,
        invitation,
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
    envelope: PassportFileEnvelopeV1,
    wrappingKey: string,
    report: (progress: GoogleIdentityProgress) => void,
  ): Promise<GoogleIdentityOperationResult> {
    report({ flow: "restore", step: "restoring" });
    const restored = await this.restoreKey(envelope, wrappingKey);
    if (Result.isError(restored)) return Result.err(restored.error);

    try {
      report({ flow: "restore", step: "signing_in" });
      const signedIn = await this.pubky.signin(restored.value.keyHandle);
      if (!Result.isError(signedIn)) {
        const verified = this.verifySessionIdentity(restored.value, signedIn.value.publicIdentity);
        if (Result.isError(verified)) return Result.err(verified.error);
        const saved = await this.saveIdentity(restored.value, credentials.googleAccount, "restored");
        if (Result.isError(saved)) return Result.err(saved.error);
        return Result.ok({
          establishmentMode: "restored",
          publicIdentity: restored.value.publicIdentity,
        });
      }

      const homeserver = await this.pubky.resolveHomeserver(
        restored.value.publicIdentity.publicKeyZ32,
      );
      if (Result.isError(homeserver) || homeserver.value !== null) {
        return Result.err({ code: "signin_failed" });
      }

      report({ flow: "repair", step: "signing_up" });
      const invitation = await this.requestSignupInvitation(credentials.googleIdToken);
      if (Result.isError(invitation)) return Result.err(invitation.error);
      const activated = await this.signupAndActivate(
        restored.value,
        invitation.value,
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

  /** Decrypts exactly 32 secret bytes, restores the key, and always clears the bytes. */
  private async restoreKey(
    envelope: PassportFileEnvelopeV1,
    wrappingKey: string,
  ): Promise<OperationResult<PubkyIdentityKey>> {
    LOGGER.info("identity.google.decrypt.started");
    const secretKey = await this.crypto.decryptSecretKeyBytes(
      envelope,
      wrappingKey,
      this.passportOrigin,
    );
    if (Result.isError(secretKey)) return Result.err({ code: "decrypt_failed" });

    try {
      const restored = await this.pubky.restoreIdentityKey({
        bytes: secretKey.value,
        format: PUBKY_SECRET_KEY_FORMAT,
      });
      if (Result.isError(restored)) return Result.err({ code: "restore_failed" });
      LOGGER.info("identity.google.restore.completed");
      return Result.ok(restored.value);
    } finally {
      secretKey.value.fill(0);
    }
  }

  /**
   * Shared activation for new and interrupted identities. Signup conflict means the
   * account already exists. Ambiguous signup or publication failures are verified
   * through blocking sign-in before they are treated as fatal.
   */
  private async signupAndActivate(
    identity: PubkyIdentityKey,
    invitation: HomeserverSignupInvitation,
    googleAccount: GoogleAccountProfile,
    report: (progress: GoogleIdentityProgress) => void,
    isReconciliation = false,
  ): Promise<OperationResult> {
    if (!isReconciliation) report({ flow: "create", step: "signing_up" });
    LOGGER.info("identity.google.signup.started");
    const signedUp = await this.pubky.signup({
      keyHandle: identity.keyHandle,
      homeserverPubky: invitation.homeserverPubky,
      signupCode: invitation.signupCode,
    });
    if (Result.isError(signedUp)
      && signedUp.error.code !== "account_exists"
      && signedUp.error.code !== "signup_uncertain") {
      return Result.err({ code: "signup_failed" });
    }
    const signupWasUncertain = Result.isError(signedUp)
      && signedUp.error.code === "signup_uncertain";
    LOGGER.info("identity.google.signup.completed", {
      status: Result.isError(signedUp) ? signedUp.error.code : "created",
    });

    report(isReconciliation
      ? { flow: "repair", step: "publishing" }
      : { flow: "create", step: "publishing" });
    LOGGER.info("identity.google.publication.started");
    const published = await this.pubky.publishHomeserver({
      keyHandle: identity.keyHandle,
      homeserverPubky: invitation.homeserverPubky,
    });
    if (Result.isError(published) && published.error.code !== "publish_failed") {
      return Result.err({ code: "publication_failed" });
    }
    const publicationWasUncertain = Result.isError(published);
    if (!publicationWasUncertain) LOGGER.info("identity.google.publication.completed");

    report(isReconciliation
      ? { flow: "repair", step: "signing_in" }
      : { flow: "create", step: "activating" });
    const signedIn = await this.pubky.signin(identity.keyHandle, {
      waitForPkdnsPublication: true,
    });
    if (Result.isError(signedIn)) {
      return Result.err({
        code: signupWasUncertain
          ? "signup_failed"
          : publicationWasUncertain ? "publication_failed" : "signin_failed",
      });
    }
    const verified = this.verifySessionIdentity(identity, signedIn.value.publicIdentity);
    if (Result.isError(verified)) return Result.err(verified.error);
    return this.saveIdentity(identity, googleAccount, "homeserver_signup");
  }

  private verifySessionIdentity(
    identity: PubkyIdentityKey,
    sessionIdentity: PubkyPublicIdentity,
  ): OperationResult {
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
  ): Promise<OperationResult> {
    LOGGER.info("identity.local_save.started", { activation });
    const secretKey = await this.pubky.exportSecretKey(identity.keyHandle);
    if (Result.isError(secretKey)) return Result.err({ code: "local_save_failed" });
    try {
      const saved = this.repository.save({
        publicIdentity: identity.publicIdentity,
        googleAccount,
      }, secretKey.value);
      if (Result.isError(saved)) return Result.err({ code: "local_save_failed" });
      LOGGER.info("identity.local_save.completed", { activation });
      return Result.ok();
    } finally {
      secretKey.value.bytes.fill(0);
    }
  }

  private async requestSignupInvitation(
    googleIdToken: string,
  ): Promise<OperationResult<HomeserverSignupInvitation>> {
    LOGGER.info("identity.google.homeserver_signup_invitation.started");
    const invitation = await this.homegate.requestGoogleHomeserverSignupInvitation(googleIdToken);
    if (Result.isError(invitation)) {
      return Result.err({
        code: "homeserver_signup_invitation_failed",
        cause: invitation.error.code,
      });
    }
    LOGGER.info("identity.google.homeserver_signup_invitation.completed");
    return Result.ok(invitation.value);
  }

  private async requestWrappingKey(googleIdToken: string): Promise<OperationResult<string>> {
    LOGGER.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.wrappingKeys.requestGoogleWrappingKey(googleIdToken);
    if (Result.isError(wrappingKey)) {
      return Result.err({ code: "wrapping_key_failed", cause: wrappingKey.error.code });
    }
    LOGGER.info("identity.google.wrapping_key.completed");
    return Result.ok(wrappingKey.value);
  }

  private async deleteVerifiedGoogleDriveFiles(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<"deleted" | "missing" | null> {
    const store = new GoogleDrivePassportFileStore(credentials.driveAccessToken, this.fetch);
    const storedFile = await store.readPassportFile();
    if (Result.isError(storedFile)) return null;

    if (storedFile.value.status === "found") {
      const wrappingKey = await this.wrappingKeys.requestGoogleWrappingKey(credentials.googleIdToken);
      if (Result.isError(wrappingKey)) return null;
      const restored = await this.restoreKey(storedFile.value.envelope, wrappingKey.value);
      if (Result.isError(restored)) return null;
      try {
        if (restored.value.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32) {
          LOGGER.warn("identity.google.delete.failed", {
            stage: "identity_validation",
            code: "identity_mismatch",
          });
          return null;
        }
      } finally {
        this.disposeIdentityKey(restored.value, "deleted_key_dispose");
      }
    }

    const visibleCopies = new GoogleDriveVisibleRecoveryCopies(
      credentials.driveAccessToken,
      this.fetch,
    );
    const deletedVisibleCopies = await visibleCopies.deleteVisibleRecoveryCopies(
      publicIdentity,
    );
    if (Result.isError(deletedVisibleCopies)) return null;
    if (storedFile.value.status === "missing") return "missing";

    const deleted = await store.deletePassportFile(storedFile.value.reference);
    return Result.isError(deleted) ? null : "deleted";
  }

  private async createVisibleRecoveryCopy(
    visibleCopies: GoogleDriveVisibleRecoveryCopies,
    envelope: PassportFileEnvelopeV1,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<boolean> {
    const controller = new AbortController();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(confirmed);
      };
      const timer = setTimeout(() => {
        controller.abort();
        finish(false);
      }, VISIBLE_RECOVERY_COPY_TIMEOUT_MS);

      void visibleCopies.createVisibleRecoveryCopy(
        envelope,
        publicIdentity,
        controller.signal,
      ).then(
        (result) => finish(!Result.isError(result)),
        () => finish(false),
      );
    });
  }

  private disposeIdentityKey(identity: PubkyIdentityKey, operation: string): void {
    try {
      this.pubky.disposeIdentityKey(identity.keyHandle);
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", { operation });
    }
  }
}
