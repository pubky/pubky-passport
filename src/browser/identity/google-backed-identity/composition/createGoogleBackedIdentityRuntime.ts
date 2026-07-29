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
  GoogleDriveIdentityDeleter,
  GoogleIdentityEstablisher,
} from "../application/googleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "../application/restoreGoogleBackedIdentity";
import { BrowserGoogleWrappingKeyRequester } from "../wrapping-key/adapters/googleWrappingKeyRequester";

// TODO: could be a class.
export type GoogleBackedIdentityRuntime = {
  identityEstablisher: GoogleIdentityEstablisher;
  identityDeleter: GoogleDriveIdentityDeleter;
  dispose(): void;
};

// TODO: rename to service
export function createGoogleBackedIdentityRuntime(input: {
  keyStore: LocalIdentityKeyStore;
  homegateBaseUrl: string;
  passportOrigin: string;
}): GoogleBackedIdentityRuntime {
  const pubky = new PubkySdkAdapter();
  try {
    const localIdentities = new SaveLocalIdentity({ keyStore: input.keyStore, identityKeys: pubky });
    const wrappingKeys = new BrowserGoogleWrappingKeyRequester();
    const homegate = new HomegateClient({
      homegateBaseUrl: input.homegateBaseUrl,
    });
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
    const identityEstablisher = new EstablishGoogleBackedIdentity({
      wrappingKeys,
      passportFileStoreForAccessToken,
      homegate,
      restoreExistingIdentity,
      createMissingIdentity,
    });
    const identityDeleter = new DeleteGoogleDriveIdentity({
      wrappingKeys,
      passportFileStoreForAccessToken,
      crypto,
      identityKeys: pubky,
      passportOrigin: input.passportOrigin,
    });

    return {
      identityEstablisher,
      identityDeleter,
      dispose: () => pubky.dispose(),
    };
  } catch (error) {
    try {
      pubky.dispose();
    } catch {
      // Preserve the construction failure after best-effort rollback.
    }
    throw error;
  }
}
