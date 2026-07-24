import "client-only";

import { GoogleDrivePassportFileRepository } from "../../passport-file/googleDrivePassportFileRepository";
import { WebCryptoPassportFileCrypto } from "../../passport-file/webCryptoPassportFileCrypto";
import { BrowserPubky } from "../../pubky/browserPubky";
import { LocalIdentityService } from "../application/localIdentityService";
import type { LocalIdentityRepository } from "../application/ports/localIdentityRepository";
import { CreateGoogleBackedIdentity } from "./application/createGoogleBackedIdentity";
import { DeleteGoogleDriveIdentity } from "./application/deleteGoogleDriveIdentity";
import { EstablishGoogleBackedIdentity } from "./application/establishGoogleBackedIdentity";
import type {
  GoogleDriveIdentityDeleter,
  GoogleIdentityEstablisher,
} from "./application/googleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "./application/restoreGoogleBackedIdentity";
import { BrowserGoogleHomegateInvitationRequester } from "./homegate-invitation/adapters/googleHomegateInvitationRequester";
import { BrowserGoogleWrappingKeyRequester } from "./wrapping-key/adapters/googleWrappingKeyRequester";

export type GoogleBackedIdentityRuntime = {
  identityEstablisher: GoogleIdentityEstablisher;
  identityDeleter: GoogleDriveIdentityDeleter;
  dispose(): void;
};

export function createGoogleBackedIdentityRuntime(input: {
  repository: LocalIdentityRepository;
  homegateBaseUrl: string;
  passportOrigin: string;
}): GoogleBackedIdentityRuntime {
  const pubky = new BrowserPubky();
  try {
    const localIdentities = new LocalIdentityService({ repository: input.repository, identityKeys: pubky });
    const wrappingKeys = new BrowserGoogleWrappingKeyRequester();
    const crypto = new WebCryptoPassportFileCrypto();
    const passportFilesForAccessToken = (token: string) => new GoogleDrivePassportFileRepository({
      accessTokenProvider: async () => token,
      fetch: globalThis.fetch.bind(globalThis),
    });
    const restoreExistingIdentity = new RestoreGoogleBackedIdentity({
      crypto,
      identityKeys: pubky,
      signup: pubky,
      localIdentities,
      passportOrigin: input.passportOrigin,
    });
    const createMissingIdentity = new CreateGoogleBackedIdentity({
      crypto,
      identityKeys: pubky,
      homegateInvitationRequester: new BrowserGoogleHomegateInvitationRequester({
        homegateBaseUrl: input.homegateBaseUrl,
      }),
      signup: pubky,
      discovery: pubky,
      localIdentities,
      passportOrigin: input.passportOrigin,
    });
    const identityEstablisher = new EstablishGoogleBackedIdentity({
      wrappingKeys,
      passportFilesForAccessToken,
      restoreExistingIdentity,
      createMissingIdentity,
    });
    const identityDeleter = new DeleteGoogleDriveIdentity({
      wrappingKeys,
      passportFilesForAccessToken,
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
