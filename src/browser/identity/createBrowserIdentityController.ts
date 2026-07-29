import "client-only";

import { GoogleIdentityServicesDriveAccessRequester } from "./google-drive-access/adapters/googleIdentityServicesDriveAccessRequester";
import { loadGoogleAccounts } from "./google-identity-services/adapters/googleIdentityServicesLoader";
import { GoogleIdentityServicesSignInButton } from "./google-sign-in/adapters/googleIdentityServicesSignInButton";
import { LocalStorageIdentityRepository } from "./local-identity/adapters/localStorageIdentityRepository";
import type { BrowserIdentityController } from "./browserIdentityController";
import { PassportIdentityController } from "./passportIdentityController";
import {
  GoogleBackedIdentityOperations,
} from "./google-backed-identity/composition/googleBackedIdentityOperations";

export function createBrowserIdentityController(input: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  const repository = new LocalStorageIdentityRepository();
  const googleIdentityServices = { loadGoogleAccounts };
  let googleBackedIdentityOperations: GoogleBackedIdentityOperations | undefined;
  const getGoogleBackedIdentityOperations = () => {
    googleBackedIdentityOperations ??= new GoogleBackedIdentityOperations({
      keyStore: repository,
      homegateBaseUrl: input.homegateBaseUrl,
      passportOrigin: globalThis.location.origin,
    });
    return googleBackedIdentityOperations;
  };

  return new PassportIdentityController({
    clientId: input.googleClientId,
    dependencies: {
      repository,
      establishGoogleBackedIdentity: (credentials) => getGoogleBackedIdentityOperations()
        .establishGoogleBackedIdentity(credentials),
      deleteGoogleDrivePassportFile: (credentials, expectedPublicKeyZ32) => getGoogleBackedIdentityOperations()
        .deleteGoogleDrivePassportFile(credentials, expectedPublicKeyZ32),
      disposeGoogleBackedIdentityOperations: () => {
        const operations = googleBackedIdentityOperations;
        googleBackedIdentityOperations = undefined;
        operations?.dispose();
      },
      googleSignInButton: new GoogleIdentityServicesSignInButton({
        clientId: input.googleClientId,
        googleIdentityServices,
      }),
      googleDriveAccessRequester: new GoogleIdentityServicesDriveAccessRequester({ googleIdentityServices }),
    },
  });
}
