import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { HomegateClient } from "../../../homegate/homegateClient";
import type { PassportFileEnvelopeV1 } from "../../../../core/passport-file/passportFile";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStoreResult,
} from "../../../passport-file/googleDrivePassportFileStore";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityCredentials,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";
import type { GoogleWrappingKeyResult } from "../../../wrapping-key/wrappingKeyApiClient";

export type {
  GoogleBackedIdentity,
  GoogleBackedIdentityError,
  GoogleBackedIdentityErrorCode,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";

export class EstablishGoogleBackedIdentity {
  readonly #requestWrappingKey: (googleIdToken: string) => Promise<GoogleWrappingKeyResult>;
  readonly #readPassportFile: ReadPassportFile;
  readonly #createPassportFile: CreatePassportFile;
  readonly #homegate: HomegateClient;
  readonly #restoreExistingIdentity: RestoreGoogleBackedIdentity;
  readonly #createMissingIdentity: CreateGoogleBackedIdentity;

  constructor(input: {
    requestWrappingKey: (googleIdToken: string) => Promise<GoogleWrappingKeyResult>;
    readPassportFile: ReadPassportFile;
    createPassportFile: CreatePassportFile;
    homegate: HomegateClient;
    restoreExistingIdentity: RestoreGoogleBackedIdentity;
    createMissingIdentity: CreateGoogleBackedIdentity;
  }) {
    this.#requestWrappingKey = input.requestWrappingKey;
    this.#readPassportFile = input.readPassportFile;
    this.#createPassportFile = input.createPassportFile;
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
    const wrappingKey = await this.#requestWrappingKey(credentials.googleIdToken);
    if (Result.isError(wrappingKey)) {
      return Result.err({ code: "wrapping_key_failed", cause: wrappingKey.error.code });
    }
    LOGGER.info("identity.google.wrapping_key.completed");

    LOGGER.info("identity.google.drive_read.started");
    const storedFile = await this.#readPassportFile(credentials.driveAccessToken);
    if (Result.isError(storedFile)) {
      LOGGER.warn("identity.google.drive_read.failed", { code: storedFile.error.code });
      return failure("drive_read_failed");
    } else if (storedFile.value.status === "found") {
      LOGGER.info("identity.google.drive_read.completed", { status: "found" });
      return this.#restoreExistingIdentity.execute(storedFile.value.envelope, wrappingKey.value);
    }

    LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
    LOGGER.info("identity.google.homeserver_signup_invitation.started");
    const invitation = await this.#homegate.requestGoogleHomeserverSignupInvitation(credentials.googleIdToken);
    if (Result.isError(invitation)) {
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", { code: invitation.error.code });
      return Result.err({ code: "homeserver_signup_invitation_failed", cause: invitation.error.code });
    }

    return this.#createMissingIdentity.execute(
      invitation.value,
      (envelope) => this.#createPassportFile(credentials.driveAccessToken, envelope),
      wrappingKey.value,
    );
  }
}

type ReadPassportFile = (driveAccessToken: string) => Promise<PassportFileStoreResult<PassportFileReadResult>>;
type CreatePassportFile = (
  driveAccessToken: string,
  envelope: PassportFileEnvelopeV1,
) => Promise<PassportFileStoreResult<PassportFileReference>>;

function failure<T>(code: "drive_read_failed" | "unexpected_failure"): GoogleBackedIdentityResult<T> {
  return Result.err({ code });
}
