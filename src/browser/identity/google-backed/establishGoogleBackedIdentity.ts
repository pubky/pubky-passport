import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import {
  HomegateClient,
  type HomegateSignupInvitationErrorCode,
} from "../../homegate/homegateClient";
import type { PassportFileEnvelopeV1 } from "../../../core/passport-file/passportFile";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStoreResult,
} from "../../passport-file/googleDrivePassportFileStore";
import {
  CreateGoogleBackedIdentity,
  type CreateGoogleBackedIdentityError,
  type CreatedGoogleBackedIdentity,
} from "./createGoogleBackedIdentity";
import {
  RestoreGoogleBackedIdentity,
  type RestoreGoogleBackedIdentityError,
  type RestoredGoogleBackedIdentity,
} from "./restoreGoogleBackedIdentity";
import type {
  GoogleWrappingKeyErrorCode,
  GoogleWrappingKeyResult,
} from "../../wrapping-key/wrappingKeyApiClient";

export type GoogleBackedIdentityCredentials = {
  googleIdToken: string;
  driveAccessToken: string;
};

export type GoogleBackedIdentity = CreatedGoogleBackedIdentity | RestoredGoogleBackedIdentity;

export type GoogleBackedIdentityError =
  | CreateGoogleBackedIdentityError
  | RestoreGoogleBackedIdentityError
  | { code: "drive_read_failed" | "unexpected_failure"; partialSetupPublicIdentity?: never }
  | { code: "wrapping_key_failed"; cause: GoogleWrappingKeyErrorCode; partialSetupPublicIdentity?: never }
  | { code: "homeserver_signup_invitation_failed"; cause: HomegateSignupInvitationErrorCode; partialSetupPublicIdentity?: never };

export type GoogleBackedIdentityResult<T = GoogleBackedIdentity> = ResultType<T, GoogleBackedIdentityError>;

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

  async establish(credentials: GoogleBackedIdentityCredentials): Promise<GoogleBackedIdentityResult> {
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
    if (Result.isError(storedFile)) return failure("drive_read_failed");
    if (storedFile.value.status === "found") {
      LOGGER.info("identity.google.drive_read.completed", { status: "found" });
      return this.#restoreExistingIdentity.execute(storedFile.value.envelope, wrappingKey.value);
    }

    LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
    LOGGER.info("identity.google.homeserver_signup_invitation.started");
    const invitation = await this.#homegate.requestGoogleHomeserverSignupInvitation(credentials.googleIdToken);
    if (Result.isError(invitation)) {
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
