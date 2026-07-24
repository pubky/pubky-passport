import "client-only";

import { GoogleIdentityServicesDriveAccessRequester } from "./google-drive-access/adapters/googleIdentityServicesDriveAccessRequester";
import { loadGoogleAccounts } from "./google-identity-services/adapters/googleIdentityServicesLoader";
import { GoogleIdentityServicesSignInButton } from "./google-sign-in/adapters/googleIdentityServicesSignInButton";
import { LocalStorageIdentityRepository } from "./local-identity/adapters/localStorageIdentityRepository";
import type { BrowserIdentityController } from "./browserIdentityController";
import { PassportIdentityController } from "./passportIdentityController";
import {
  createGoogleBackedIdentityRuntime,
  type GoogleBackedIdentityRuntime,
} from "./google-backed-identity/composition/createGoogleBackedIdentityRuntime";

export function createBrowserIdentityController(input: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  const repository = new LocalStorageIdentityRepository();
  const googleIdentityServices = { loadGoogleAccounts };
  let identityRuntime: GoogleBackedIdentityRuntime | undefined;
  const getIdentityRuntime = () => {
    identityRuntime ??= createGoogleBackedIdentityRuntime({
      keyStore: repository,
      homegateBaseUrl: input.homegateBaseUrl,
      passportOrigin: globalThis.location.origin,
    });
    return identityRuntime;
  };

  return new PassportIdentityController({
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
        runtime?.dispose();
      },
      googleSignInButton: new GoogleIdentityServicesSignInButton({
        clientId: input.googleClientId,
        googleIdentityServices,
      }),
      googleDriveAccessRequester: new GoogleIdentityServicesDriveAccessRequester({ googleIdentityServices }),
    },
  });
}
