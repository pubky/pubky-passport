import "client-only";

import { Result } from "better-result";

import type { PassportFileStore } from "../../passport-file/ports";
import type {
  CreateMissingGoogleDriveIdentity,
  GoogleBackedIdentity,
  GoogleBackedIdentityFlowResult,
  GoogleIdentitySession,
  GoogleWrappingKeyRequester,
  RestoreExistingGoogleDriveIdentity,
} from "./ports";
import { logger } from "../../../libs/logger/logger";

export type {
  GoogleBackedIdentity,
  GoogleBackedIdentityFlowError,
  GoogleBackedIdentityFlowErrorCode,
  GoogleBackedIdentityFlowResult,
} from "./ports";

export class GoogleBackedIdentityFlow {
  readonly #wrappingKeys: GoogleWrappingKeyRequester;
  readonly #passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
  readonly #restoreExistingIdentity: RestoreExistingGoogleDriveIdentity;
  readonly #createMissingIdentity: CreateMissingGoogleDriveIdentity;

  constructor(input: {
    wrappingKeys: GoogleWrappingKeyRequester;
    passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
    restoreExistingIdentity: RestoreExistingGoogleDriveIdentity;
    createMissingIdentity: CreateMissingGoogleDriveIdentity;
  }) {
    this.#wrappingKeys = input.wrappingKeys;
    this.#passportFilesForAccessToken = input.passportFilesForAccessToken;
    this.#restoreExistingIdentity = input.restoreExistingIdentity;
    this.#createMissingIdentity = input.createMissingIdentity;
  }

  async establish(google: GoogleIdentitySession): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    try {
      return await this.establishIdentity(google);
    } catch {
      logger.warn("identity.google.establish.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async establishIdentity(google: GoogleIdentitySession): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    logger.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.#wrappingKeys.requestWrappingKey({ googleIdToken: google.googleIdToken });
    if (Result.isError(wrappingKey)) {
      logger.warn("identity.google.wrapping_key.failed", { code: wrappingKey.error.code });
      return failure("wrapping_key_failed");
    }
    logger.info("identity.google.wrapping_key.completed");

    const passportFiles = this.#passportFilesForAccessToken(google.driveAccessToken);
    logger.info("identity.google.drive_read.started");
    const storedFile = await passportFiles.readPassportFile();
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
    return this.#createMissingIdentity.execute({
      googleIdToken: google.googleIdToken,
      passportFiles,
      wrappingKey: wrappingKey.value,
    });
  }
}

function failure<T>(code: "wrapping_key_failed" | "drive_read_failed" | "unexpected_failure"): GoogleBackedIdentityFlowResult<T> {
  return Result.err({ code });
}
