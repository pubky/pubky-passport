import "client-only";

import { LOGGER } from "../../../../libs/logger/logger";
import type { PubkyPublicIdentity } from "../pubkyPublicIdentity";
import { HomegateClient } from "../../homegate/homegateClient";
import {
  GoogleDrivePassportFileStore,
  type PassportFileReference,
} from "../../passport-file/googleDrivePassportFileStore";
import { GoogleDriveVisibleRecoveryCopyWriter } from "../../passport-file/googleDriveVisibleRecoveryCopyWriter";
import { GoogleDriveVisibleRecoveryCopyDeleter } from "../../passport-file/googleDriveVisibleRecoveryCopyDeleter";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import { PassportFileWebCrypto } from "../../passport-file/passportFileWebCrypto";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { WrappingKeyApiClient } from "../../wrapping-key/wrappingKeyApiClient";
import { LocalStorageIdentityRepository } from "../local/localStorageIdentityRepository";
import { SaveLocalIdentity, type SaveLocalIdentityOperation } from "../local/saveLocalIdentity";
import { ActivateGoogleBackedIdentity } from "./activateGoogleBackedIdentity";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";
import { DeleteGoogleIdentityBackups } from "./deleteGoogleIdentityBackups";
import {
  DetachGoogleBackedIdentity,
  type DetachGoogleBackedIdentityResult,
} from "./detachGoogleBackedIdentity";
import {
  EstablishGoogleBackedIdentity,
  type GoogleBackedIdentityResult,
  type ReportGoogleBackedIdentityProgress,
} from "./establishGoogleBackedIdentity";
import type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";
import {
  ResumeIncompleteGoogleBackedIdentity,
  type ResumeIncompleteGoogleBackedIdentityResult,
} from "./resumeIncompleteGoogleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";
import { RestoreGoogleBackedIdentityKey } from "./restoreGoogleBackedIdentityKey";

/** Screen-scoped composition root and owner of the shared Pubky SDK adapter. */
export class GoogleBackedIdentityOperations {
  readonly #pubky: PubkySdkAdapter;
  readonly #establishIdentity: EstablishGoogleBackedIdentity;
  readonly #resumeIncompleteIdentity: ResumeIncompleteGoogleBackedIdentity;
  readonly #detachIdentity: DetachGoogleBackedIdentity;
  #disposed = false;

  constructor(input: {
    repository: LocalStorageIdentityRepository;
    homegateBaseUrl: string;
    passportOrigin: string;
  }) {
    const pubky = new PubkySdkAdapter();
    try {
      const localIdentitySaver = new SaveLocalIdentity(input.repository, pubky);
      const saveIdentityLocally: SaveLocalIdentityOperation = (keyHandle, googleAccount) =>
        localIdentitySaver.saveIdentity(keyHandle, googleAccount);
      const wrappingKeyApiClient = new WrappingKeyApiClient();
      const requestWrappingKey: WrappingKeyApiClient["requestGoogleWrappingKey"] = (googleIdToken) =>
        wrappingKeyApiClient.requestGoogleWrappingKey(googleIdToken);
      const homegateClient = new HomegateClient({ homegateBaseUrl: input.homegateBaseUrl });
      const passportFileCrypto = new PassportFileWebCrypto();
      const encryptSecretKeyBytes: PassportFileWebCrypto["encryptSecretKeyBytes"] = (encryptInput) =>
        passportFileCrypto.encryptSecretKeyBytes(encryptInput);
      const decryptSecretKeyBytes: PassportFileWebCrypto["decryptSecretKeyBytes"] = (decryptInput) =>
        passportFileCrypto.decryptSecretKeyBytes(decryptInput);
      const driveFetch: typeof fetch = (request, init) => globalThis.fetch(request, init);
      const createPassportFileStore = (driveAccessToken: string) => new GoogleDrivePassportFileStore({
        accessTokenProvider: async () => driveAccessToken,
        fetch: driveFetch,
      });
      const createVisibleRecoveryCopyWriter = (driveAccessToken: string) => new GoogleDriveVisibleRecoveryCopyWriter({
        accessTokenProvider: async () => driveAccessToken,
        fetch: driveFetch,
      });
      const visibleRecoveryCopyDeleter = new GoogleDriveVisibleRecoveryCopyDeleter({ fetch: driveFetch });
      const readPassportFile = (driveAccessToken: string) =>
        createPassportFileStore(driveAccessToken).readPassportFile();
      const createPassportFile = (driveAccessToken: string, envelope: PassportFileEnvelopeV1) =>
        createPassportFileStore(driveAccessToken).createPassportFile(envelope);
      const createVisibleRecoveryCopy = (
        driveAccessToken: string,
        envelope: PassportFileEnvelopeV1,
        publicKeyDisplay: string,
        signal: AbortSignal,
      ) => createVisibleRecoveryCopyWriter(driveAccessToken).createVisibleRecoveryCopy(
        envelope,
        publicKeyDisplay,
        signal,
      );
      const deletePassportFileByReference = (
        driveAccessToken: string,
        reference: PassportFileReference,
      ) => createPassportFileStore(driveAccessToken).deletePassportFile(reference);

      const restoreIdentityKey = new RestoreGoogleBackedIdentityKey({
        decryptSecretKeyBytes,
        pubky,
        passportOrigin: input.passportOrigin,
      });
      const restoreKey = (envelope: PassportFileEnvelopeV1, wrappingKey: string) =>
        restoreIdentityKey.execute(envelope, wrappingKey);
      const activateIdentity = new ActivateGoogleBackedIdentity({
        pubky,
        saveIdentityLocally,
      });
      const activate = (
        ...activationInput: Parameters<ActivateGoogleBackedIdentity["execute"]>
      ) => activateIdentity.execute(...activationInput);
      const restoreIdentity = new RestoreGoogleBackedIdentity(
        restoreKey,
        pubky,
        saveIdentityLocally,
      );
      const createIdentity = new CreateGoogleBackedIdentity({
        encryptSecretKeyBytes,
        pubky,
        activateIdentity: activate,
        passportOrigin: input.passportOrigin,
      });
      const deleteBackups = new DeleteGoogleIdentityBackups({
        requestWrappingKey,
        readPassportFile,
        deletePassportFileByReference,
        deleteVisibleRecoveryCopies: (driveAccessToken, publicKeyDisplay) =>
          visibleRecoveryCopyDeleter.deleteVisibleRecoveryCopies(driveAccessToken, publicKeyDisplay),
        decryptSecretKeyBytes,
        pubky,
        passportOrigin: input.passportOrigin,
      });
      const establishIdentity = new EstablishGoogleBackedIdentity({
        requestWrappingKey,
        readPassportFile,
        requestSignupInvitation: (googleIdToken) =>
          homegateClient.requestGoogleHomeserverSignupInvitation(googleIdToken),
        createPassportFile,
        createVisibleRecoveryCopy,
        restoreIdentity: (envelope, wrappingKey, reportProgress, googleAccount) =>
          restoreIdentity.execute(envelope, wrappingKey, reportProgress, googleAccount),
        createIdentity: (
          invitation,
          createOperationalFile,
          createVisibleCopy,
          wrappingKey,
          reportProgress,
          googleAccount,
        ) => createIdentity.execute(
          invitation,
          createOperationalFile,
          createVisibleCopy,
          wrappingKey,
          reportProgress,
          googleAccount,
        ),
      });
      const deleteGoogleBackups: DeleteGoogleIdentityBackups["deleteGoogleIdentityBackups"] = (
        credentials,
        publicIdentity,
        expectedGoogleAccountId,
      ) => deleteBackups.deleteGoogleIdentityBackups(
        credentials,
        publicIdentity,
        expectedGoogleAccountId,
      );

      this.#establishIdentity = establishIdentity;
      this.#resumeIncompleteIdentity = new ResumeIncompleteGoogleBackedIdentity({
        requestWrappingKey,
        readPassportFile,
        requestSignupInvitation: (googleIdToken) =>
          homegateClient.requestGoogleHomeserverSignupInvitation(googleIdToken),
        restoreIdentityKey: restoreKey,
        activateIdentity: activate,
        pubky,
      });
      this.#detachIdentity = new DetachGoogleBackedIdentity(
        deleteGoogleBackups,
        (identityId: string) => input.repository.remove(identityId),
      );
      this.#pubky = pubky;
    } catch (error) {
      try {
        pubky.dispose();
      } catch {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: "construction_pubky_dispose",
        });
      }
      throw error;
    }
  }

  establishIdentity(
    credentials: GoogleBackedIdentityCredentials,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<GoogleBackedIdentityResult> {
    return this.#establishIdentity.execute(credentials, reportProgress);
  }

  resumeIncompleteIdentity(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<ResumeIncompleteGoogleBackedIdentityResult> {
    return this.#resumeIncompleteIdentity.execute(
      credentials,
      publicIdentity,
      reportProgress,
    );
  }

  detachIdentity(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<DetachGoogleBackedIdentityResult> {
    return this.#detachIdentity.execute(credentials, publicIdentity, expectedGoogleAccountId);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pubky.dispose();
  }
}
