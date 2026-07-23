import "client-only";

import { GoogleDrivePassportFileRepository } from "../passport-file/googleDrivePassportFileRepository";
import { WebCryptoPassportFileCrypto } from "../passport-file/webCryptoPassportFileCrypto";
import { BrowserPubky } from "../pubky/browserPubky";
import { requestGoogleDriveAccess } from "./google/googleIdentityProvider";
import { GoogleSignInWidget } from "./google/googleSignInWidget";
import { GoogleBackedIdentityFlow } from "./google/googleBackedIdentityFlow";
import { CreateMissingGoogleDriveIdentityUseCase } from "./google/createMissingGoogleDriveIdentity";
import { DeleteGoogleBackedIdentity } from "./google/deleteGoogleBackedIdentity";
import { BrowserGoogleHomegateInviteRequester } from "./google/googleHomegateInviteRequester";
import { BrowserGoogleWrappingKeyRequester } from "./google/googleWrappingKeyRequester";
import { RestoreExistingGoogleDriveIdentityUseCase } from "./google/restoreExistingGoogleDriveIdentity";
import type { BrowserIdentityController } from "./browserIdentityController";
import { DefaultBrowserIdentityController } from "./browserIdentityControllerInternals";
import { LocalStorageIdentityRepository } from "./localIdentityRepository";
import { LocalIdentityService } from "./localIdentityService";

export function createBrowserIdentityController(input: {
  googleClientId: string;
  passportUrl: string;
}): BrowserIdentityController {
  const pubky = new BrowserPubky();
  const repository = new LocalStorageIdentityRepository();
  const localIdentities = new LocalIdentityService({ repository, identityKeys: pubky });
  const wrappingKeys = new BrowserGoogleWrappingKeyRequester();
  const crypto = new WebCryptoPassportFileCrypto();
  const passportFilesForAccessToken = (token: string) => new GoogleDrivePassportFileRepository({
    accessTokenProvider: async () => token,
    fetch: globalThis.fetch.bind(globalThis),
  });
  const restoreExistingIdentity = new RestoreExistingGoogleDriveIdentityUseCase({
    crypto,
    identityKeys: pubky,
    signup: pubky,
    localIdentities,
    passportUrl: input.passportUrl,
  });
  const createMissingIdentity = new CreateMissingGoogleDriveIdentityUseCase({
    crypto,
    identityKeys: pubky,
    homegateInvites: new BrowserGoogleHomegateInviteRequester(),
    signup: pubky,
    discovery: pubky,
    localIdentities,
    passportUrl: input.passportUrl,
  });
  const identityFlow = new GoogleBackedIdentityFlow({
    wrappingKeys,
    passportFilesForAccessToken,
    restoreExistingIdentity,
    createMissingIdentity,
  });
  const identityDeletion = new DeleteGoogleBackedIdentity({
    wrappingKeys,
    passportFilesForAccessToken,
    crypto,
    identityKeys: pubky,
    passportUrl: input.passportUrl,
  });

  return new DefaultBrowserIdentityController({
    clientId: input.googleClientId,
    dependencies: {
      repository,
      identityFlow,
      identityDeletion,
      identityKeys: pubky,
      disposePubky: () => pubky.dispose(),
      googleSignInWidget: new GoogleSignInWidget({ clientId: input.googleClientId }),
      requestGoogleDriveAccess,
    },
  });
}
