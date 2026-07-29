import "client-only";

import { GoogleIdentityServicesDriveAccessRequester } from "./google-drive-access/adapters/googleIdentityServicesDriveAccessRequester";
import { loadGoogleAccounts } from "./google-identity-services/adapters/googleIdentityServicesLoader";
import { GoogleIdentityServicesSignInButton } from "./google-sign-in/adapters/googleIdentityServicesSignInButton";
import { LocalStorageIdentityRepository } from "./local-identity/adapters/localStorageIdentityRepository";
import type { BrowserIdentityController } from "./browserIdentityController";
import { PassportIdentityController } from "./passportIdentityController";
import {
  GoogleIdentityActions,
  type GoogleIdentityLifecycle,
} from "./google-backed-identity/composition/googleIdentityActions";

export function createBrowserIdentityController(input: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  const repository = new LocalStorageIdentityRepository();
  const googleIdentityServices = { loadGoogleAccounts };
  let identityActions: GoogleIdentityLifecycle | undefined;
  const getIdentityActions = () => {
    identityActions ??= new GoogleIdentityActions({
      keyStore: repository,
      homegateBaseUrl: input.homegateBaseUrl,
      passportOrigin: globalThis.location.origin,
    });
    return identityActions;
  };

  return new PassportIdentityController({
    clientId: input.googleClientId,
    dependencies: {
      repository,
      identityEstablisher: {
        establish: (google) => getIdentityActions().establish(google),
      },
      identityDeleter: {
        execute: (google, expectedPublicKeyZ32) => getIdentityActions().deleteDriveIdentity(
          google,
          expectedPublicKeyZ32,
        ),
      },
      disposeIdentityActions: () => {
        const actions = identityActions;
        identityActions = undefined;
        actions?.dispose();
      },
      googleSignInButton: new GoogleIdentityServicesSignInButton({
        clientId: input.googleClientId,
        googleIdentityServices,
      }),
      googleDriveAccessRequester: new GoogleIdentityServicesDriveAccessRequester({ googleIdentityServices }),
    },
  });
}
