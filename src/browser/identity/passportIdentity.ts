import "client-only";

import { GoogleAuthorizationCode } from "../google-authorization/googleAuthorizationCode";
import { GoogleIdentityServices } from "../google-identity-services/googleIdentityServices";
import { LOGGER } from "../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "./local/localStorageIdentityRepository";
import {
  PassportIdentityController as PassportIdentityControllerImplementation,
} from "./passportIdentityController";
import {
  GoogleBackedIdentityOperations,
} from "./google-backed/googleBackedIdentityOperations";
import { resolvePubkyHomeserver } from "../pubky/pubkySdkAdapter";

export type PassportIdentityController = Pick<
  PassportIdentityControllerImplementation,
  | "list"
  | "select"
  | "remove"
  | "clear"
  | "subscribe"
  | "resolveHomeserver"
  | "prepareGoogleAuthorization"
  | "disposeGoogleAuthorization"
  | "retryGoogleAuthorization"
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
export type { GoogleBackedIdentityProgress } from "./google-backed/googleBackedIdentityProgress";
export type { PubkyHomeserverResolutionResult } from "../pubky/pubkySdkAdapter";

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
  const googleAuthorization = new GoogleAuthorizationCode({ clientId: googleClientId, googleIdentityServices });
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
    remove: repository.remove.bind(repository),
    clear: repository.clear.bind(repository),
    subscribe: repository.subscribe.bind(repository),
    resolveHomeserver: resolvePubkyHomeserver,
    restoreOrCreateGoogleBackedIdentity: (credentials, reportProgress) => getGoogleBackedIdentityOperations()
      .restoreOrCreateGoogleBackedIdentity(credentials, reportProgress),
    deleteGoogleDrivePassportFile: (credentials, expectedPublicKeyZ32) => getGoogleBackedIdentityOperations()
      .deleteGoogleDrivePassportFile(credentials, expectedPublicKeyZ32),
    disposeGoogleBackedIdentityOperations: () => {
      const operations = googleBackedIdentityOperations;
      googleBackedIdentityOperations = undefined;
      operations?.dispose();
    },
    prepareGoogleAuthorization: googleAuthorization.prepare.bind(googleAuthorization),
    requestGoogleAuthorization: googleAuthorization.request.bind(googleAuthorization),
    disposeGoogleAuthorization: googleAuthorization.dispose.bind(googleAuthorization),
  });
}
