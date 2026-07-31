import "client-only";

import { GoogleDriveAccess } from "../google-drive-access/googleDriveAccess";
import { GoogleIdentityServices } from "../google-identity-services/googleIdentityServices";
import { GoogleIdentityServicesSignInButton } from "../google-sign-in/googleIdentityServicesSignInButton";
import { LOGGER } from "../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "./local/localStorageIdentityRepository";
import {
  PassportIdentityController as PassportIdentityControllerImplementation,
} from "./passportIdentityController";
import {
  GoogleBackedIdentityOperations,
} from "./google-backed/googleBackedIdentityOperations";

export type PassportIdentityController = Pick<
  PassportIdentityControllerImplementation,
  | "list"
  | "select"
  | "clear"
  | "subscribe"
  | "mountGoogleSignIn"
  | "unmountGoogleSignIn"
  | "retryGoogleSignIn"
  | "continueGoogleBackedIdentityAction"
  | "dispose"
>;

export type {
  GoogleBackedIdentityAction,
  GoogleBackedIdentityActionDispatchResult,
  GoogleBackedIdentityActionErrorCode,
  GoogleBackedIdentityActionResult,
  GoogleBackedIdentityActionState,
  LocalIdentitySummary,
  PassportIdentityList,
} from "./passportIdentityController";

export function createPassportIdentityController(
  googleClientId: string,
  homegateBaseUrl: string,
): PassportIdentityController {
  try {
    return createController(googleClientId, homegateBaseUrl);
  } catch (error) {
    LOGGER.error("identity.controller.failed", {
      operation: "initialize",
      code: "runtime_exception",
    });
    throw error;
  }
}

function createController(
  googleClientId: string,
  homegateBaseUrl: string,
): PassportIdentityController {
  const repository = new LocalStorageIdentityRepository();
  const googleIdentityServices = new GoogleIdentityServices();
  const googleSignInButton = new GoogleIdentityServicesSignInButton({
    clientId: googleClientId,
    googleIdentityServices,
  });
  const googleDriveAccess = new GoogleDriveAccess({
    googleIdentityServices,
    clientId: googleClientId,
    fetch: globalThis.fetch.bind(globalThis),
  });
  let googleBackedIdentityOperations: GoogleBackedIdentityOperations | undefined;
  const getGoogleBackedIdentityOperations = () => {
    googleBackedIdentityOperations ??= new GoogleBackedIdentityOperations({
      saveIdentityRecord: repository.save.bind(repository),
      homegateBaseUrl,
      passportOrigin: globalThis.location.origin,
    });
    return googleBackedIdentityOperations;
  };

  return new PassportIdentityControllerImplementation({
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
  });
}
