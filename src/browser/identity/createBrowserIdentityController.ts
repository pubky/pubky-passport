import "client-only";

import { GoogleDrivePassportFileRepository } from "../passport-file/googleDrivePassportFileRepository";
import { WebCryptoPassportFileCrypto } from "../passport-file/webCryptoPassportFileCrypto";
import { BrowserPubky } from "../pubky/browserPubky";
import { BrowserGoogleHomegateInviteRequester } from "./adapters/google/googleHomegateInviteRequester";
import { requestGoogleDriveAccess } from "./adapters/google/googleIdentityProvider";
import { GoogleSignInWidget } from "./adapters/google/googleSignInWidget";
import { BrowserGoogleWrappingKeyRequester } from "./adapters/google/googleWrappingKeyRequester";
import { LocalStorageIdentityRepository } from "./adapters/localStorageIdentityRepository";
import { CreateGoogleDriveIdentity } from "./application/createGoogleDriveIdentity";
import { DeleteGoogleDriveIdentity } from "./application/deleteGoogleDriveIdentity";
import { EstablishGoogleBackedIdentity } from "./application/establishGoogleBackedIdentity";
import { LocalIdentityService } from "./application/localIdentityService";
import { RestoreGoogleDriveIdentity } from "./application/restoreGoogleDriveIdentity";
import type { BrowserIdentityController } from "./browserIdentityController";
import { DefaultBrowserIdentityController } from "./defaultBrowserIdentityController";

export function createBrowserIdentityController(input: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  const repository = new LocalStorageIdentityRepository();
  let identityRuntime: ReturnType<typeof createIdentityRuntime> | undefined;
  const getIdentityRuntime = () => {
    identityRuntime ??= createIdentityRuntime({
      repository,
      homegateBaseUrl: input.homegateBaseUrl,
      passportOrigin: globalThis.location.origin,
    });
    return identityRuntime;
  };

  return new DefaultBrowserIdentityController({
    clientId: input.googleClientId,
    dependencies: {
      repository,
      identityEstablisher: {
        establish: (google) => getIdentityRuntime().identityEstablisher.establish(google),
      },
      identityDeleter: {
        execute: (google, expectedPublicKeyZ32) => getIdentityRuntime().identityDeleter.execute(
          google,
          expectedPublicKeyZ32,
        ),
      },
      disposeIdentityRuntime: () => {
        const runtime = identityRuntime;
        identityRuntime = undefined;
        runtime?.pubky.dispose();
      },
      googleSignInWidget: new GoogleSignInWidget({ clientId: input.googleClientId }),
      requestGoogleDriveAccess,
    },
  });
}

function createIdentityRuntime(input: {
  repository: LocalStorageIdentityRepository;
  homegateBaseUrl: string;
  passportOrigin: string;
}) {
  const pubky = new BrowserPubky();
  try {
    const localIdentities = new LocalIdentityService({ repository: input.repository, identityKeys: pubky });
    const wrappingKeys = new BrowserGoogleWrappingKeyRequester();
    const crypto = new WebCryptoPassportFileCrypto();
    const passportFilesForAccessToken = (token: string) => new GoogleDrivePassportFileRepository({
      accessTokenProvider: async () => token,
      fetch: globalThis.fetch.bind(globalThis),
    });
    const restoreExistingIdentity = new RestoreGoogleDriveIdentity({
      crypto,
      identityKeys: pubky,
      signup: pubky,
      localIdentities,
      passportOrigin: input.passportOrigin,
    });
    const createMissingIdentity = new CreateGoogleDriveIdentity({
      crypto,
      identityKeys: pubky,
      homegateInvitationRequester: new BrowserGoogleHomegateInviteRequester({
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

    return { pubky, identityEstablisher, identityDeleter };
  } catch (error) {
    try {
      pubky.dispose();
    } catch {
      // Preserve the construction failure after best-effort rollback.
    }
    throw error;
  }
}
