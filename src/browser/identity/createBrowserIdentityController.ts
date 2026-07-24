import "client-only";

import { requestGoogleDriveAccess } from "./adapters/google/googleIdentityProvider";
import { GoogleSignInWidget } from "./adapters/google/googleSignInWidget";
import { LocalStorageIdentityRepository } from "./adapters/localStorageIdentityRepository";
import type { BrowserIdentityController } from "./browserIdentityController";
import { DefaultBrowserIdentityController } from "./defaultBrowserIdentityController";
import {
  createGoogleBackedIdentityRuntime,
  type GoogleBackedIdentityRuntime,
} from "./google-backed-identity/createGoogleBackedIdentityRuntime";

export function createBrowserIdentityController(input: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  const repository = new LocalStorageIdentityRepository();
  let identityRuntime: GoogleBackedIdentityRuntime | undefined;
  const getIdentityRuntime = () => {
    identityRuntime ??= createGoogleBackedIdentityRuntime({
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
        runtime?.dispose();
      },
      googleSignInWidget: new GoogleSignInWidget({ clientId: input.googleClientId }),
      requestGoogleDriveAccess,
    },
  });
}
