import "client-only";

import { requestGoogleDriveAccessToken } from "./google-drive-access/adapters/googleDriveAccessToken";
import { loadGoogleAccounts } from "./google-identity-services/adapters/googleIdentityServicesLoader";
import { GoogleIdentityServicesSignInButton } from "./google-sign-in/adapters/googleIdentityServicesSignInButton";
import { LocalStorageIdentityRepository } from "./local-identity/adapters/localStorageIdentityRepository";
import type { BrowserIdentityController } from "./browserIdentityController";
import { PassportIdentityController } from "./passportIdentityController";
import {
  GoogleBackedIdentityOperations,
} from "./google-backed-identity/composition/googleBackedIdentityOperations";

export function createBrowserIdentityController(options: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  const repository = new LocalStorageIdentityRepository();
  const googleIdentityServices = { loadGoogleAccounts };
  const googleSignInButton = new GoogleIdentityServicesSignInButton({
    clientId: options.googleClientId,
    googleIdentityServices,
  });
  let googleBackedIdentityOperations: GoogleBackedIdentityOperations | undefined;
  const getGoogleBackedIdentityOperations = () => {
    googleBackedIdentityOperations ??= new GoogleBackedIdentityOperations({
      saveIdentityRecord: repository.save.bind(repository),
      homegateBaseUrl: options.homegateBaseUrl,
      passportOrigin: globalThis.location.origin,
    });
    return googleBackedIdentityOperations;
  };

  return new PassportIdentityController({
    dependencies: {
      list: repository.list.bind(repository),
      select: repository.select.bind(repository),
      clear: repository.clear.bind(repository),
      subscribe: repository.subscribe.bind(repository),
      establishGoogleBackedIdentity: (credentials) => getGoogleBackedIdentityOperations()
        .establishGoogleBackedIdentity(credentials),
      deleteGoogleDrivePassportFile: (credentials, expectedPublicKeyZ32) => getGoogleBackedIdentityOperations()
        .deleteGoogleDrivePassportFile(credentials, expectedPublicKeyZ32),
      disposeGoogleBackedIdentityOperations: () => {
        const operations = googleBackedIdentityOperations;
        googleBackedIdentityOperations = undefined;
        operations?.dispose();
      },
      mountGoogleSignIn: googleSignInButton.mount.bind(googleSignInButton),
      unmountGoogleSignIn: googleSignInButton.unmount.bind(googleSignInButton),
      requestGoogleDriveAccess: (googleSubject, signal) => requestGoogleDriveAccessToken({
        googleIdentityServices,
        clientId: options.googleClientId,
        loginHint: googleSubject,
        expectedSubject: googleSubject,
        fetch: globalThis.fetch.bind(globalThis),
        signal,
      }),
    },
  });
}
