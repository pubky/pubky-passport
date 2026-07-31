import "client-only";

import { GoogleDriveAccess } from "../google-drive-access/googleDriveAccess";
import { GoogleIdentityServices } from "../google-identity-services/googleIdentityServices";
import { GoogleIdentityServicesSignInButton } from "../google-sign-in/googleIdentityServicesSignInButton";
import { LOGGER } from "../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "./local-identity/localStorageIdentityRepository";
import type { BrowserIdentityController } from "./browserIdentityController";
import { PassportIdentityController } from "./passportIdentityController";
import {
  GoogleBackedIdentityOperations,
} from "./google-backed-identity/googleBackedIdentityOperations";

export function createBrowserIdentityController(options: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  try {
    return createController(options);
  } catch (error) {
    LOGGER.error("identity.controller.failed", {
      operation: "initialize",
      code: "runtime_exception",
    });
    throw error;
  }
}

function createController(options: {
  googleClientId: string;
  homegateBaseUrl: string;
}): BrowserIdentityController {
  const repository = new LocalStorageIdentityRepository();
  const googleIdentityServices = new GoogleIdentityServices();
  const googleSignInButton = new GoogleIdentityServicesSignInButton({
    clientId: options.googleClientId,
    googleIdentityServices,
  });
  const googleDriveAccess = new GoogleDriveAccess({
    googleIdentityServices,
    clientId: options.googleClientId,
    fetch: globalThis.fetch.bind(globalThis),
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
      requestGoogleDriveAccess: (googleSubject, signal) => googleDriveAccess.requestAccessToken({
        expectedSubject: googleSubject,
        signal,
      }),
    },
  });
}
