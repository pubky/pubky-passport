import "client-only";

import { GoogleDrivePassportFileRepository } from "../passport-file/googleDrivePassportFileRepository";
import { WebCryptoPassportFileCrypto } from "../passport-file/webCryptoPassportFileCrypto";
import { BrowserPubky } from "../pubky/browserPubky";
import {
  bindGoogleCredentialCallback,
  googleIdTokenSubject,
  loadGoogleAccounts,
  releaseGoogleCredentialCallback,
  requestGoogleDriveAccess,
} from "./google/googleIdentityProvider";
import { GoogleBackedIdentityFlow } from "./google/googleBackedIdentityFlow";
import { DeleteGoogleBackedIdentity } from "./google/deleteGoogleBackedIdentity";
import { BrowserGoogleHomegateInviteRequester } from "./google/googleHomegateInviteRequester";
import { BrowserGoogleWrappingKeyRequester } from "./google/googleWrappingKeyRequester";
import { DefaultBrowserIdentityController, type BrowserIdentityController } from "./browserIdentityController";
import { LocalStorageIdentityRepository } from "./localIdentityRepository";
import { LocalIdentityService } from "./localIdentityService";

export function createBrowserIdentityController(input: {
  googleClientId: string;
  passportUrl: string;
}): BrowserIdentityController {
  const allowLocalhostHttp = new URL(input.passportUrl).protocol === "http:";
  const pubky = new BrowserPubky();
  const repository = new LocalStorageIdentityRepository();
  const localIdentities = new LocalIdentityService({ repository, identityKeys: pubky });
  const wrappingKeys = new BrowserGoogleWrappingKeyRequester();
  const crypto = new WebCryptoPassportFileCrypto();
  const passportFilesForAccessToken = (token: string) => new GoogleDrivePassportFileRepository({
    accessTokenProvider: async () => token,
    fetch: globalThis.fetch.bind(globalThis),
    allowLocalhostHttp,
  });
  const identityFlow = new GoogleBackedIdentityFlow({
    wrappingKeys,
    passportFilesForAccessToken,
    crypto,
    identityKeys: pubky,
    homegateInvites: new BrowserGoogleHomegateInviteRequester(),
    signup: pubky,
    discovery: pubky,
    localIdentities,
    passportUrl: input.passportUrl,
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
      loadGoogleAccounts,
      bindGoogleCredentialCallback,
      releaseGoogleCredentialCallback,
      googleIdTokenSubject,
      requestGoogleDriveAccess,
    },
  });
}
