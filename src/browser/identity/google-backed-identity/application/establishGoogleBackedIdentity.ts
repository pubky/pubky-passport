import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { HomegateClient } from "../../../homegate/adapters/homegateClient";
import type { PassportFileStore } from "../../../passport-file/application/passportFileStore";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityCredentials,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";
import type { GoogleWrappingKeyRequester } from "../wrapping-key/application/googleWrappingKey";

export type {
  GoogleBackedIdentity,
  GoogleBackedIdentityError,
  GoogleBackedIdentityErrorCode,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";

export class EstablishGoogleBackedIdentity {
  readonly #wrappingKeyRequester: GoogleWrappingKeyRequester;
  readonly #passportFileStoreForAccessToken: (driveAccessToken: string) => PassportFileStore;
  readonly #homegate: HomegateClient;
  readonly #restoreExistingIdentity: RestoreGoogleBackedIdentity;
  readonly #createMissingIdentity: CreateGoogleBackedIdentity;

  constructor(input: {
    wrappingKeyRequester: GoogleWrappingKeyRequester;
    passportFileStoreForAccessToken: (driveAccessToken: string) => PassportFileStore;
    homegate: HomegateClient;
    restoreExistingIdentity: RestoreGoogleBackedIdentity;
    createMissingIdentity: CreateGoogleBackedIdentity;
  }) {
    this.#wrappingKeyRequester = input.wrappingKeyRequester;
    this.#passportFileStoreForAccessToken = input.passportFileStoreForAccessToken;
    this.#homegate = input.homegate;
    this.#restoreExistingIdentity = input.restoreExistingIdentity;
    this.#createMissingIdentity = input.createMissingIdentity;
  }

  async establish(credentials: GoogleBackedIdentityCredentials): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    try {
      return await this.establishIdentity(credentials);
    } catch {
      LOGGER.warn("identity.google.establish.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async establishIdentity(credentials: GoogleBackedIdentityCredentials): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    LOGGER.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.#wrappingKeyRequester.requestWrappingKey({ googleIdToken: credentials.googleIdToken });
    if (Result.isError(wrappingKey)) {
      LOGGER.warn("identity.google.wrapping_key.failed", { code: wrappingKey.error.code });
      return failure("wrapping_key_failed");
    }
    LOGGER.info("identity.google.wrapping_key.completed");

    const passportFileStore = this.#passportFileStoreForAccessToken(credentials.driveAccessToken);
    LOGGER.info("identity.google.drive_read.started");
    const storedFile = await passportFileStore.readPassportFile();
    if (Result.isError(storedFile)) {
      LOGGER.warn("identity.google.drive_read.failed", { code: storedFile.error.code });
      return failure("drive_read_failed");
    } else if (storedFile.value.status === "found") {
      LOGGER.info("identity.google.drive_read.completed", { status: "found" });
      return this.#restoreExistingIdentity.execute({
        envelope: storedFile.value.envelope,
        wrappingKey: wrappingKey.value,
      });
    }

    LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
    LOGGER.info("identity.google.homeserver_signup_invitation.started");
    const invitation = await this.#homegate.requestGoogleHomeserverSignupInvitation(credentials.googleIdToken);
    if (Result.isError(invitation)) {
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", { code: invitation.error.code });
      return Result.err({ code: "homeserver_signup_invitation_failed", cause: invitation.error.code });
    }

    return this.#createMissingIdentity.execute({
      invitation: invitation.value,
      passportFileStore,
      wrappingKey: wrappingKey.value,
    });
  }
}

function failure<T>(code: "wrapping_key_failed" | "drive_read_failed" | "unexpected_failure"): GoogleBackedIdentityResult<T> {
  return Result.err({ code });
}
