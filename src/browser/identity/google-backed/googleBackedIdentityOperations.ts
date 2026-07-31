import "client-only";

import { LOGGER } from "../../../libs/logger/logger";
import { HomegateClient } from "../../homegate/homegateClient";
import { GoogleDrivePassportFileStore } from "../../passport-file/googleDrivePassportFileStore";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import type { PassportFileReference } from "../../passport-file/googleDrivePassportFileStore";
import { PassportFileWebCrypto } from "../../passport-file/passportFileWebCrypto";
import type { PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { WrappingKeyApiClient } from "../../wrapping-key/wrappingKeyApiClient";
import type {
  LocalIdentityResult,
  LocalIdentitySummary,
} from "../local/localStorageIdentityRepository";
import { SaveLocalIdentity } from "../local/saveLocalIdentity";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";
import { DeleteGoogleDrivePassportFile } from "./deleteGoogleDrivePassportFile";
import {
  EstablishGoogleBackedIdentity,
  type GoogleBackedIdentityCredentials,
} from "./establishGoogleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";

export class GoogleBackedIdentityOperations {
  readonly #pubky: PubkySdkAdapter;
  readonly #establishGoogleBackedIdentity: EstablishGoogleBackedIdentity;
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
      this.#establishGoogleBackedIdentity = new EstablishGoogleBackedIdentity({
        requestWrappingKey,
        readPassportFile,
        createPassportFile,
        homegate: homegateClient,
        restoreExistingIdentity,
        createMissingIdentity,
      });
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

  establishGoogleBackedIdentity(credentials: GoogleBackedIdentityCredentials) {
    return this.#establishGoogleBackedIdentity.establish(credentials);
  }

  deleteGoogleDrivePassportFile(credentials: GoogleBackedIdentityCredentials, expectedPublicKeyZ32: string) {
    return this.#passportFileDeleter.deleteGoogleDrivePassportFile(credentials, expectedPublicKeyZ32);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pubky.dispose();
  }
}
