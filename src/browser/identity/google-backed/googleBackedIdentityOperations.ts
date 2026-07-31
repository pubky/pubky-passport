import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
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
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import { PassportFileWebCrypto } from "../../passport-file/passportFileWebCrypto";
import type { PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import {
  WrappingKeyApiClient,
  type GoogleWrappingKeyErrorCode,
} from "../../wrapping-key/wrappingKeyApiClient";
import type {
  LocalIdentityResult,
  LocalIdentitySummary,
} from "../local/localStorageIdentityRepository";
import { SaveLocalIdentity } from "../local/saveLocalIdentity";
import {
  CreateGoogleBackedIdentity,
  type CreateGoogleBackedIdentityError,
  type CreatedGoogleBackedIdentity,
} from "./createGoogleBackedIdentity";
import { DeleteGoogleDrivePassportFile } from "./deleteGoogleDrivePassportFile";
import type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";
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
  | { code: "drive_read_failed" | "unexpected_failure"; partialSetupPublicIdentity?: never }
  | { code: "wrapping_key_failed"; cause: GoogleWrappingKeyErrorCode; partialSetupPublicIdentity?: never }
  | { code: "homeserver_signup_invitation_failed"; cause: HomegateSignupInvitationErrorCode; partialSetupPublicIdentity?: never };

export type GoogleBackedIdentityResult<T = GoogleBackedIdentity> = ResultType<T, GoogleBackedIdentityError>;

export class GoogleBackedIdentityOperations {
  readonly #pubky: PubkySdkAdapter;
  readonly #requestWrappingKey: WrappingKeyApiClient["requestGoogleWrappingKey"];
  readonly #readPassportFile: ReadPassportFile;
  readonly #createPassportFile: CreatePassportFile;
  readonly #homegate: HomegateClient;
  readonly #restoreExistingIdentity: RestoreGoogleBackedIdentity;
  readonly #createMissingIdentity: CreateGoogleBackedIdentity;
  readonly #passportFileDeleter: DeleteGoogleDrivePassportFile;
  #disposed = false;

  constructor(input: {
    saveIdentityRecord: (
      identity: LocalIdentitySummary,
      secretKey: PubkySecretKeyMaterial,
    ) => LocalIdentityResult<LocalIdentitySummary>;
    homegateBaseUrl: string;
    passportOrigin: string;
  }) {
    const pubky = new PubkySdkAdapter();
    try {
      const saveLocalIdentity = new SaveLocalIdentity(input.saveIdentityRecord, pubky);
      const wrappingKeyApiClient = new WrappingKeyApiClient();
      const requestWrappingKey = wrappingKeyApiClient.requestGoogleWrappingKey.bind(wrappingKeyApiClient);
      const homegateClient = new HomegateClient({ homegateBaseUrl: input.homegateBaseUrl });
      const passportFileCrypto = new PassportFileWebCrypto();
      const encryptSecretKeyBytes = passportFileCrypto.encryptSecretKeyBytes.bind(passportFileCrypto);
      const decryptSecretKeyBytes = passportFileCrypto.decryptSecretKeyBytes.bind(passportFileCrypto);
      const createPassportFileStore = (driveAccessToken: string) => new GoogleDrivePassportFileStore({
        accessTokenProvider: async () => driveAccessToken,
        fetch: globalThis.fetch.bind(globalThis),
      });
      const readPassportFile = (driveAccessToken: string) => createPassportFileStore(driveAccessToken).readPassportFile();
      const createPassportFile = (driveAccessToken: string, envelope: PassportFileEnvelopeV1) => createPassportFileStore(driveAccessToken).createPassportFile(envelope);
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
      this.#homegate = homegateClient;
      this.#restoreExistingIdentity = restoreExistingIdentity;
      this.#createMissingIdentity = createMissingIdentity;
      this.#passportFileDeleter = new DeleteGoogleDrivePassportFile({
        requestWrappingKey,
        readPassportFile,
        deletePassportFileByReference,
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
  ): Promise<GoogleBackedIdentityResult> {
    try {
      return await this.restoreOrCreateIdentity(credentials);
    } catch {
      LOGGER.warn("identity.google.restore_or_create.failed", { code: "unexpected_failure" });
      return operationFailure("unexpected_failure");
    }
  }

  deleteGoogleDrivePassportFile(credentials: GoogleBackedIdentityCredentials, expectedPublicKeyZ32: string) {
    return this.#passportFileDeleter.deleteGoogleDrivePassportFile(credentials, expectedPublicKeyZ32);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pubky.dispose();
  }

  private async restoreOrCreateIdentity(
    credentials: GoogleBackedIdentityCredentials,
  ): Promise<GoogleBackedIdentityResult> {
    LOGGER.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.#requestWrappingKey(credentials.googleIdToken);
    if (Result.isError(wrappingKey)) {
      return Result.err({ code: "wrapping_key_failed", cause: wrappingKey.error.code });
    }
    LOGGER.info("identity.google.wrapping_key.completed");

    LOGGER.info("identity.google.drive_read.started");
    const storedFile = await this.#readPassportFile(credentials.driveAccessToken);
    if (Result.isError(storedFile)) return operationFailure("drive_read_failed");
    if (storedFile.value.status === "found") {
      LOGGER.info("identity.google.drive_read.completed", { status: "found" });
      return this.#restoreExistingIdentity.execute(storedFile.value.envelope, wrappingKey.value);
    }

    LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
    LOGGER.info("identity.google.homeserver_signup_invitation.started");
    const invitation = await this.#homegate.requestGoogleHomeserverSignupInvitation(credentials.googleIdToken);
    if (Result.isError(invitation)) {
      return Result.err({ code: "homeserver_signup_invitation_failed", cause: invitation.error.code });
    }

    return this.#createMissingIdentity.execute(
      invitation.value,
      (envelope) => this.#createPassportFile(credentials.driveAccessToken, envelope),
      wrappingKey.value,
    );
  }
}

type ReadPassportFile = (driveAccessToken: string) => Promise<PassportFileStoreResult<PassportFileReadResult>>;
type CreatePassportFile = (
  driveAccessToken: string,
  envelope: PassportFileEnvelopeV1,
) => Promise<PassportFileStoreResult<PassportFileReference>>;

function operationFailure<T>(
  code: "drive_read_failed" | "unexpected_failure",
): GoogleBackedIdentityResult<T> {
  return Result.err({ code });
}
