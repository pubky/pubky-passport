import "client-only";

import { LOGGER } from "../../../libs/logger/logger";
import { HomegateClient } from "../../homegate/homegateClient";
import { GoogleDrivePassportFileStore } from "../../passport-file/googleDrivePassportFileStore";
import { PassportFileWebCrypto } from "../../passport-file/passportFileWebCrypto";
import type { PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { WrappingKeyApiClient } from "../../wrapping-key/wrappingKeyApiClient";
import type { LocalIdentityResult, LocalIdentitySummary } from "../local-identity/localIdentity";
import { SaveLocalIdentity } from "../local-identity/saveLocalIdentity";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";
import { DeleteGoogleDrivePassportFile } from "./deleteGoogleDrivePassportFile";
import { EstablishGoogleBackedIdentity } from "./establishGoogleBackedIdentity";
import type {
  GoogleBackedIdentityCredentials,
} from "./googleBackedIdentity";
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
      const localIdentities = new SaveLocalIdentity({
        saveIdentityRecord: input.saveIdentityRecord,
        pubky,
      });
      const wrappingKeyApiClient = new WrappingKeyApiClient();
      const requestWrappingKey = wrappingKeyApiClient.requestGoogleWrappingKey.bind(wrappingKeyApiClient);
      const homegate = new HomegateClient({ homegateBaseUrl: input.homegateBaseUrl });
      const crypto = new PassportFileWebCrypto();
      const encryptSecretKeyBytes = crypto.encryptSecretKeyBytes.bind(crypto);
      const decryptSecretKeyBytes = crypto.decryptSecretKeyBytes.bind(crypto);
      const storeFor = (token: string) => new GoogleDrivePassportFileStore({
        accessTokenProvider: async () => token,
        fetch: globalThis.fetch.bind(globalThis),
      });
      const readPassportFile = (token: string) => storeFor(token).readPassportFile();
      const createPassportFile = (token: string, envelope: Parameters<GoogleDrivePassportFileStore["createPassportFile"]>[0]) => storeFor(token).createPassportFile(envelope);
      const deletePassportFile = (token: string, reference: Parameters<GoogleDrivePassportFileStore["deletePassportFile"]>[0]) => storeFor(token).deletePassportFile(reference);
      const restoreExistingIdentity = new RestoreGoogleBackedIdentity({
        decryptSecretKeyBytes,
        pubky,
        localIdentities,
        passportOrigin: input.passportOrigin,
      });
      const createMissingIdentity = new CreateGoogleBackedIdentity({
        encryptSecretKeyBytes,
        pubky,
        localIdentities,
        passportOrigin: input.passportOrigin,
      });
      this.#establishGoogleBackedIdentity = new EstablishGoogleBackedIdentity({
        requestWrappingKey,
        readPassportFile,
        createPassportFile,
        homegate,
        restoreExistingIdentity,
        createMissingIdentity,
      });
      this.#passportFileDeleter = new DeleteGoogleDrivePassportFile({
        requestWrappingKey,
        readPassportFile,
        deletePassportFile,
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
