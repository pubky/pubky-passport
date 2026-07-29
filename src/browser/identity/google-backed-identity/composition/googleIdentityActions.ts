import "client-only";

import { HomegateClient } from "../../../homegate/adapters/homegateClient";
import { GoogleDrivePassportFileStore } from "../../../passport-file/adapters/googleDrivePassportFileStore";
import { WebCryptoPassportFileCrypto } from "../../../passport-file/adapters/webCryptoPassportFileCrypto";
import { PubkySdkAdapter } from "../../../pubky/adapters/pubkySdkAdapter";
import type { LocalIdentityKeyStore } from "../../local-identity/application/localIdentityRepository";
import { SaveLocalIdentity } from "../../local-identity/application/saveLocalIdentity";
import { CreateGoogleBackedIdentity } from "../application/createGoogleBackedIdentity";
import { DeleteGoogleDriveIdentity } from "../application/deleteGoogleDriveIdentity";
import { EstablishGoogleBackedIdentity } from "../application/establishGoogleBackedIdentity";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityResult,
  GoogleDriveIdentityDeletionResult,
  GoogleDriveIdentityDeleter,
  GoogleIdentityEstablisher,
  GoogleIdentitySession,
} from "../application/googleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "../application/restoreGoogleBackedIdentity";
import { BrowserGoogleWrappingKeyRequester } from "../wrapping-key/adapters/googleWrappingKeyRequester";

export interface GoogleIdentityLifecycle {
  establish(google: GoogleIdentitySession): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>>;
  deleteDriveIdentity(
    google: GoogleIdentitySession,
    expectedPublicKeyZ32: string,
  ): Promise<GoogleDriveIdentityDeletionResult>;
  dispose(): void;
}

export class GoogleIdentityActions implements GoogleIdentityLifecycle {
  readonly #pubky: PubkySdkAdapter;
  readonly #identityEstablisher: GoogleIdentityEstablisher;
  readonly #identityDeleter: GoogleDriveIdentityDeleter;
  #disposed = false;

  constructor(input: {
    keyStore: LocalIdentityKeyStore;
    homegateBaseUrl: string;
    passportOrigin: string;
  }) {
    const pubky = new PubkySdkAdapter();
    try {
      const localIdentities = new SaveLocalIdentity({ keyStore: input.keyStore, identityKeys: pubky });
      const wrappingKeys = new BrowserGoogleWrappingKeyRequester();
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
      this.#identityEstablisher = new EstablishGoogleBackedIdentity({
        wrappingKeys,
        passportFileStoreForAccessToken,
        homegate,
        restoreExistingIdentity,
        createMissingIdentity,
      });
      this.#identityDeleter = new DeleteGoogleDriveIdentity({
        wrappingKeys,
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

  establish(google: GoogleIdentitySession) {
    return this.#identityEstablisher.establish(google);
  }

  deleteDriveIdentity(google: GoogleIdentitySession, expectedPublicKeyZ32: string) {
    return this.#identityDeleter.execute(google, expectedPublicKeyZ32);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pubky.dispose();
  }
}
