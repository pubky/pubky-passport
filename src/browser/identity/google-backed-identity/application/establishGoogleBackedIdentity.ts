import "client-only";

import { Result } from "better-result";

import { logger } from "../../../../libs/logger/logger";
import type { PassportFileStore } from "../../../passport-file/application/passportFileStore";
import type { GoogleSignupInvitationRequester } from "../../../homegate/application/homegateInvitation";
import type {
  GoogleBackedIdentityCreator,
  GoogleBackedIdentityRestorer,
  GoogleBackedIdentity,
  GoogleBackedIdentityResult,
  GoogleIdentityEstablisher,
  GoogleIdentitySession,
} from "./googleBackedIdentity";
import type { GoogleWrappingKeyRequester } from "../wrapping-key/application/googleWrappingKey";

export type {
  GoogleBackedIdentity,
  GoogleBackedIdentityError,
  GoogleBackedIdentityErrorCode,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";

export class EstablishGoogleBackedIdentity implements GoogleIdentityEstablisher {
  readonly #wrappingKeys: GoogleWrappingKeyRequester;
  readonly #passportFileStoreForAccessToken: (driveAccessToken: string) => PassportFileStore;
  readonly #homegate: GoogleSignupInvitationRequester;
  readonly #restoreExistingIdentity: GoogleBackedIdentityRestorer;
  readonly #createMissingIdentity: GoogleBackedIdentityCreator;

  constructor(input: {
    wrappingKeys: GoogleWrappingKeyRequester;
    passportFileStoreForAccessToken: (driveAccessToken: string) => PassportFileStore;
    homegate: GoogleSignupInvitationRequester;
    restoreExistingIdentity: GoogleBackedIdentityRestorer;
    createMissingIdentity: GoogleBackedIdentityCreator;
  }) {
    this.#wrappingKeys = input.wrappingKeys;
    this.#passportFileStoreForAccessToken = input.passportFileStoreForAccessToken;
    this.#homegate = input.homegate;
    this.#restoreExistingIdentity = input.restoreExistingIdentity;
    this.#createMissingIdentity = input.createMissingIdentity;
  }

  async establish(google: GoogleIdentitySession): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    try {
      return await this.establishIdentity(google);
    } catch {
      logger.warn("identity.google.establish.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async establishIdentity(google: GoogleIdentitySession): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    logger.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.#wrappingKeys.requestWrappingKey({ googleIdToken: google.googleIdToken });
    if (Result.isError(wrappingKey)) {
      logger.warn("identity.google.wrapping_key.failed", { code: wrappingKey.error.code });
      return failure("wrapping_key_failed");
    }
    logger.info("identity.google.wrapping_key.completed");

    const passportFileStore = this.#passportFileStoreForAccessToken(google.driveAccessToken);
    logger.info("identity.google.drive_read.started");
    const storedFile = await passportFileStore.readPassportFile();
    if (Result.isError(storedFile)) {
      logger.warn("identity.google.drive_read.failed", { code: storedFile.error.code });
      return failure("drive_read_failed");
    } else if (storedFile.value.status === "found") {
      logger.info("identity.google.drive_read.completed", { status: "found" });
      return this.#restoreExistingIdentity.execute({
        envelope: storedFile.value.envelope,
        wrappingKey: wrappingKey.value,
      });
    }

    logger.info("identity.google.drive_read.completed", { status: "missing" });
    logger.info("identity.google.homegate_invite.started");
    const invitation = await this.#homegate.requestGoogleSignupInvitation({
      googleIdToken: google.googleIdToken,
    });
    if (Result.isError(invitation)) {
      logger.warn("identity.google.homegate_invite.failed", { code: invitation.error.code });
      return Result.err({ code: "homegate_invite_failed", cause: invitation.error.code });
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
