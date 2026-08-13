import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import {
  HomegateClient,
  type HomegateSignupInvitationErrorCode,
} from "../../homegate/homegateClient";
import {
  GoogleDrivePassportFileStore,
  type PassportFileReadResult,
  type PassportFileReference,
  type PassportFileStoreResult,
} from "../../passport-file/googleDrivePassportFileStore";
import { GoogleDriveVisibleRecoveryCopyWriter } from "../../passport-file/googleDriveVisibleRecoveryCopyWriter";
import { GoogleDriveVisibleRecoveryCopyDeleter } from "../../passport-file/googleDriveVisibleRecoveryCopyDeleter";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import { PassportFileWebCrypto } from "../../passport-file/passportFileWebCrypto";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import {
  WrappingKeyApiClient,
  type GoogleWrappingKeyErrorCode,
} from "../../wrapping-key/wrappingKeyApiClient";
import { LocalStorageIdentityRepository } from "../local/localStorageIdentityRepository";
import { SaveLocalIdentity } from "../local/saveLocalIdentity";
import {
  CreateGoogleBackedIdentity,
  type CreateGoogleBackedIdentityError,
  type CreatedGoogleBackedIdentity,
} from "./createGoogleBackedIdentity";
import { DeleteGoogleIdentityBackups } from "./deleteGoogleIdentityBackups";
import type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";
import type {
  ReportGoogleBackedIdentityProgress,
} from "./googleBackedIdentityProgress";
import {
  RestoreGoogleBackedIdentity,
  type RestoreGoogleBackedIdentityError,
  type RestoredGoogleBackedIdentity,
} from "./restoreGoogleBackedIdentity";

export type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";

export type GoogleBackedIdentity = CreatedGoogleBackedIdentity | RestoredGoogleBackedIdentity;

export type GoogleBackedIdentityError =
  | CreateGoogleBackedIdentityError
  | RestoreGoogleBackedIdentityError
  | { code: "drive_read_failed" | "unexpected_failure"; preservedPassportFileIdentity?: never }
  | { code: "wrapping_key_failed"; cause: GoogleWrappingKeyErrorCode; preservedPassportFileIdentity?: never }
  | { code: "homeserver_signup_invitation_failed"; cause: HomegateSignupInvitationErrorCode; preservedPassportFileIdentity?: never };

export type GoogleBackedIdentityResult<Success = GoogleBackedIdentity> = ResultType<Success, GoogleBackedIdentityError>;

export class GoogleBackedIdentityOperations {
  readonly #pubky: PubkySdkAdapter;
  readonly #requestWrappingKey: WrappingKeyApiClient["requestGoogleWrappingKey"];
  readonly #readPassportFile: ReadPassportFile;
  readonly #createPassportFile: CreatePassportFile;
  readonly #createVisibleRecoveryCopy: CreateVisibleRecoveryCopy;
  readonly #homegate: HomegateClient;
  readonly #restoreExistingIdentity: RestoreGoogleBackedIdentity;
  readonly #createMissingIdentity: CreateGoogleBackedIdentity;
  readonly #identityBackupDeleter: DeleteGoogleIdentityBackups;
  #disposed = false;

  constructor(input: {
    repository: LocalStorageIdentityRepository;
    homegateBaseUrl: string;
    passportOrigin: string;
  }) {
    const pubky = new PubkySdkAdapter();
    try {
      const saveLocalIdentity = new SaveLocalIdentity(input.repository, pubky);
      const wrappingKeyApiClient = new WrappingKeyApiClient();
      const requestWrappingKey = wrappingKeyApiClient.requestGoogleWrappingKey.bind(wrappingKeyApiClient);
      const homegateClient = new HomegateClient({ homegateBaseUrl: input.homegateBaseUrl });
      const passportFileCrypto = new PassportFileWebCrypto();
      const encryptSecretKeyBytes = passportFileCrypto.encryptSecretKeyBytes.bind(passportFileCrypto);
      const decryptSecretKeyBytes = passportFileCrypto.decryptSecretKeyBytes.bind(passportFileCrypto);
      const driveFetch = globalThis.fetch.bind(globalThis);
      const createPassportFileStore = (driveAccessToken: string) => new GoogleDrivePassportFileStore({
        accessTokenProvider: async () => driveAccessToken,
        fetch: driveFetch,
      });
      const createVisibleRecoveryCopyWriter = (driveAccessToken: string) => new GoogleDriveVisibleRecoveryCopyWriter({
        accessTokenProvider: async () => driveAccessToken,
        fetch: driveFetch,
      });
      const visibleRecoveryCopyDeleter = new GoogleDriveVisibleRecoveryCopyDeleter({ fetch: driveFetch });
      const readPassportFile = (driveAccessToken: string) => createPassportFileStore(driveAccessToken).readPassportFile();
      const createPassportFile = (driveAccessToken: string, envelope: PassportFileEnvelopeV1) => createPassportFileStore(driveAccessToken).createPassportFile(envelope);
      const createVisibleRecoveryCopy = (
        driveAccessToken: string,
        envelope: PassportFileEnvelopeV1,
        publicKeyDisplay: string,
        signal: AbortSignal,
      ) => createVisibleRecoveryCopyWriter(driveAccessToken).createVisibleRecoveryCopy(
        envelope,
        publicKeyDisplay,
        signal,
      );
      const deletePassportFileByReference = (driveAccessToken: string, reference: PassportFileReference) => createPassportFileStore(driveAccessToken).deletePassportFile(reference);
      const restoreExistingIdentity = new RestoreGoogleBackedIdentity({
        decryptSecretKeyBytes,
        pubky,
        saveLocalIdentity,
        passportOrigin: input.passportOrigin,
      });
      const createMissingIdentity = new CreateGoogleBackedIdentity({
        encryptSecretKeyBytes,
        pubky,
        saveLocalIdentity,
        passportOrigin: input.passportOrigin,
      });
      this.#requestWrappingKey = requestWrappingKey;
      this.#readPassportFile = readPassportFile;
      this.#createPassportFile = createPassportFile;
      this.#createVisibleRecoveryCopy = createVisibleRecoveryCopy;
      this.#homegate = homegateClient;
      this.#restoreExistingIdentity = restoreExistingIdentity;
      this.#createMissingIdentity = createMissingIdentity;
      this.#identityBackupDeleter = new DeleteGoogleIdentityBackups({
        requestWrappingKey,
        readPassportFile,
        deletePassportFileByReference,
        deleteVisibleRecoveryCopies: visibleRecoveryCopyDeleter.deleteVisibleRecoveryCopies.bind(visibleRecoveryCopyDeleter),
        decryptSecretKeyBytes,
        pubky,
        passportOrigin: input.passportOrigin,
      });
      this.#pubky = pubky;
    } catch (error) {
      try {
        pubky.dispose();
      } catch {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: "construction_pubky_dispose",
        });
      }
      throw error;
    }
  }

  async restoreOrCreateGoogleBackedIdentity(
    credentials: GoogleBackedIdentityCredentials,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<GoogleBackedIdentityResult> {
    const report = safeProgressReporter(reportProgress);
    try {
      return await this.restoreOrCreateIdentity(credentials, report);
    } catch {
      LOGGER.warn("identity.google.restore_or_create.failed", { code: "unexpected_failure" });
      return operationFailure("unexpected_failure");
    }
  }

  deleteGoogleIdentityBackups(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ) {
    return this.#identityBackupDeleter.deleteGoogleIdentityBackups(
      credentials,
      publicIdentity,
      expectedGoogleAccountId,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pubky.dispose();
  }

  private async restoreOrCreateIdentity(
    credentials: GoogleBackedIdentityCredentials,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<GoogleBackedIdentityResult> {
    reportProgress("preparing_secure_identity");
    LOGGER.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.#requestWrappingKey(credentials.googleIdToken);
    if (Result.isError(wrappingKey)) {
      return Result.err({ code: "wrapping_key_failed", cause: wrappingKey.error.code });
    }
    LOGGER.info("identity.google.wrapping_key.completed");

    reportProgress("checking_passport_file");
    LOGGER.info("identity.google.drive_read.started");
    const storedFile = await this.#readPassportFile(credentials.driveAccessToken);
    if (Result.isError(storedFile)) return operationFailure("drive_read_failed");
    if (storedFile.value.status === "found") {
      LOGGER.info("identity.google.drive_read.completed", { status: "found" });
      return this.#restoreExistingIdentity.execute(
        storedFile.value.envelope,
        wrappingKey.value,
        reportProgress,
        credentials.googleAccount,
      );
    }

    LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
    reportProgress("preparing_new_identity");
    LOGGER.info("identity.google.homeserver_signup_invitation.started");
    const invitation = await this.#homegate.requestGoogleHomeserverSignupInvitation(credentials.googleIdToken);
    if (Result.isError(invitation)) {
      return Result.err({ code: "homeserver_signup_invitation_failed", cause: invitation.error.code });
    }
    LOGGER.info("identity.google.homeserver_signup_invitation.completed");

    reportProgress("creating_identity");
    return this.#createMissingIdentity.execute(
      invitation.value,
      (envelope) => this.#createPassportFile(credentials.driveAccessToken, envelope),
      (envelope, publicKeyDisplay, signal) => this.#createVisibleRecoveryCopy(
        credentials.driveAccessToken,
        envelope,
        publicKeyDisplay,
        signal,
      ),
      wrappingKey.value,
      reportProgress,
      credentials.googleAccount,
    );
  }
}

type ReadPassportFile = (driveAccessToken: string) => Promise<PassportFileStoreResult<PassportFileReadResult>>;
type CreatePassportFile = (
  driveAccessToken: string,
  envelope: PassportFileEnvelopeV1,
) => Promise<PassportFileStoreResult<void>>;
type CreateVisibleRecoveryCopy = (
  driveAccessToken: string,
  envelope: PassportFileEnvelopeV1,
  publicKeyDisplay: string,
  signal: AbortSignal,
) => Promise<ResultType<void, unknown>>;

function operationFailure<Success>(
  code: "drive_read_failed" | "unexpected_failure",
): GoogleBackedIdentityResult<Success> {
  return Result.err({ code });
}

function safeProgressReporter(
  reportProgress: ReportGoogleBackedIdentityProgress,
): ReportGoogleBackedIdentityProgress {
  return (progress) => {
    try {
      reportProgress(progress);
    } catch {
      LOGGER.warn("identity.google.progress_listener.failed");
    }
  };
}
