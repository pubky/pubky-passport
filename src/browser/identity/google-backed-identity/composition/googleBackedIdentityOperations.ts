import "client-only";

import { HomegateClient } from "../../../homegate/adapters/homegateClient";
import { GoogleDrivePassportFileStore } from "../../../passport-file/adapters/googleDrivePassportFileStore";
import { WebCryptoPassportFileCrypto } from "../../../passport-file/adapters/webCryptoPassportFileCrypto";
import { PubkySdkAdapter } from "../../../pubky/adapters/pubkySdkAdapter";
import type { LocalIdentityKeyStore } from "../../local-identity/application/localIdentityRepository";
import { SaveLocalIdentity } from "../../local-identity/application/saveLocalIdentity";
import { CreateGoogleBackedIdentity } from "../application/createGoogleBackedIdentity";
import { DeleteGoogleDrivePassportFile } from "../application/deleteGoogleDrivePassportFile";
import { EstablishGoogleBackedIdentity } from "../application/establishGoogleBackedIdentity";
import type {
  GoogleBackedIdentityCredentials,
} from "../application/googleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "../application/restoreGoogleBackedIdentity";
import { GoogleWrappingKeyApiClient } from "../wrapping-key/adapters/googleWrappingKeyApiClient";

export class GoogleBackedIdentityOperations {
  readonly #pubky: PubkySdkAdapter;
  readonly #establishGoogleBackedIdentity: EstablishGoogleBackedIdentity;
  readonly #passportFileDeleter: DeleteGoogleDrivePassportFile;
  #disposed = false;

  constructor(input: {
    keyStore: LocalIdentityKeyStore;
    homegateBaseUrl: string;
    passportOrigin: string;
  }) {
    const pubky = new PubkySdkAdapter();
    try {
      const localIdentities = new SaveLocalIdentity({ keyStore: input.keyStore, identityKeys: pubky });
      const wrappingKeyRequester = new GoogleWrappingKeyApiClient();
      const homegate = new HomegateClient({ homegateBaseUrl: input.homegateBaseUrl });
      const crypto = new WebCryptoPassportFileCrypto();
      const passportFileStoreForAccessToken = (token: string) => new GoogleDrivePassportFileStore({
        accessTokenProvider: async () => token,
        fetch: globalThis.fetch.bind(globalThis),
      });
      const restoreExistingIdentity = new RestoreGoogleBackedIdentity({
        crypto,
        identityKeys: pubky,
        sessionAccess: pubky,
        localIdentities,
        passportOrigin: input.passportOrigin,
      });
      const createMissingIdentity = new CreateGoogleBackedIdentity({
        crypto,
        identityKeys: pubky,
        sessionAccess: pubky,
        discovery: pubky,
        localIdentities,
        passportOrigin: input.passportOrigin,
      });
      this.#establishGoogleBackedIdentity = new EstablishGoogleBackedIdentity({
        wrappingKeyRequester,
        passportFileStoreForAccessToken,
        homegate,
        restoreExistingIdentity,
        createMissingIdentity,
      });
      this.#passportFileDeleter = new DeleteGoogleDrivePassportFile({
        wrappingKeyRequester,
        passportFileStoreForAccessToken,
        crypto,
        identityKeys: pubky,
        passportOrigin: input.passportOrigin,
      });
      this.#pubky = pubky;
    } catch (error) {
      try {
        pubky.dispose();
      } catch {
        // Preserve the construction failure after best-effort rollback.
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
