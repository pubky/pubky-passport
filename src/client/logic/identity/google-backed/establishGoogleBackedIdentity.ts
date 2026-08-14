import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import type {
  HomegateClient,
  HomegateSignupInvitationErrorCode,
} from "../../homegate/homegateClient";
import type {
  PassportFileReadResult,
  PassportFileStoreResult,
} from "../../passport-file/googleDrivePassportFileStore";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import type { GoogleWrappingKeyErrorCode, WrappingKeyApiClient } from "../../wrapping-key/wrappingKeyApiClient";
import type {
  CreateGoogleBackedIdentity,
  CreateGoogleBackedIdentityError,
  CreateGoogleBackedIdentityProgress,
  CreatedGoogleBackedIdentity,
} from "./createGoogleBackedIdentity";
import type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";
import type {
  RestoreGoogleBackedIdentity,
  RestoreGoogleBackedIdentityError,
  RestoreGoogleBackedIdentityProgress,
  RestoredGoogleBackedIdentity,
} from "./restoreGoogleBackedIdentity";

export type GoogleBackedIdentity = CreatedGoogleBackedIdentity | RestoredGoogleBackedIdentity;

export type GoogleBackedIdentityError =
  | CreateGoogleBackedIdentityError
  | RestoreGoogleBackedIdentityError
  | { code: "drive_read_failed" | "unexpected_failure"; preservedPassportFileIdentity?: never }
  | { code: "wrapping_key_failed"; cause: GoogleWrappingKeyErrorCode; preservedPassportFileIdentity?: never }
  | { code: "homeserver_signup_invitation_failed"; cause: HomegateSignupInvitationErrorCode; preservedPassportFileIdentity?: never };

export type GoogleBackedIdentityResult<Success = GoogleBackedIdentity> = ResultType<
  Success,
  GoogleBackedIdentityError
>;

/** Payload-free phases safe to expose through UI state. */
export type GoogleBackedIdentityProgress =
  | "preparing_secure_identity"
  | "checking_passport_file"
  | "preparing_new_identity"
  | "creating_identity"
  | CreateGoogleBackedIdentityProgress
  | RestoreGoogleBackedIdentityProgress;

export type ReportGoogleBackedIdentityProgress = (
  progress: GoogleBackedIdentityProgress,
) => void;

export class EstablishGoogleBackedIdentity {
  constructor(private readonly dependencies: {
    requestWrappingKey: WrappingKeyApiClient["requestGoogleWrappingKey"];
    readPassportFile: ReadPassportFile;
    requestSignupInvitation: HomegateClient["requestGoogleHomeserverSignupInvitation"];
    createPassportFile: CreatePassportFile;
    createVisibleRecoveryCopy: CreateVisibleRecoveryCopy;
    restoreIdentity: RestoreGoogleBackedIdentity["execute"];
    createIdentity: CreateGoogleBackedIdentity["execute"];
  }) {}

  async execute(
    credentials: GoogleBackedIdentityCredentials,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<GoogleBackedIdentityResult> {
    const report = safeProgressReporter(reportProgress);
    try {
      return await this.establish(credentials, report);
    } catch {
      LOGGER.warn("identity.google.restore_or_create.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async establish(
    credentials: GoogleBackedIdentityCredentials,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<GoogleBackedIdentityResult> {
    reportProgress("preparing_secure_identity");
    LOGGER.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.dependencies.requestWrappingKey(credentials.googleIdToken);
    if (Result.isError(wrappingKey)) {
      return Result.err({ code: "wrapping_key_failed", cause: wrappingKey.error.code });
    }
    LOGGER.info("identity.google.wrapping_key.completed");

    reportProgress("checking_passport_file");
    LOGGER.info("identity.google.drive_read.started");
    const storedFile = await this.dependencies.readPassportFile(credentials.driveAccessToken);
    if (Result.isError(storedFile)) return failure("drive_read_failed");
    if (storedFile.value.status === "found") {
      LOGGER.info("identity.google.drive_read.completed", { status: "found" });
      return this.dependencies.restoreIdentity(
        storedFile.value.envelope,
        wrappingKey.value,
        reportProgress,
        credentials.googleAccount,
      );
    }

    LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
    reportProgress("preparing_new_identity");
    LOGGER.info("identity.google.homeserver_signup_invitation.started");
    const invitation = await this.dependencies.requestSignupInvitation(credentials.googleIdToken);
    if (Result.isError(invitation)) {
      return Result.err({ code: "homeserver_signup_invitation_failed", cause: invitation.error.code });
    }
    LOGGER.info("identity.google.homeserver_signup_invitation.completed");

    reportProgress("creating_identity");
    return this.dependencies.createIdentity(
      invitation.value,
      (envelope) => this.dependencies.createPassportFile(credentials.driveAccessToken, envelope),
      (envelope, publicKeyDisplay, signal) => this.dependencies.createVisibleRecoveryCopy(
        credentials.driveAccessToken,
        envelope,
        publicKeyDisplay,
        signal,
      ),
      wrappingKey.value,
      reportProgress,
      credentials.googleAccount,
    );
  }
}

type ReadPassportFile = (
  driveAccessToken: string,
) => Promise<PassportFileStoreResult<PassportFileReadResult>>;

type CreatePassportFile = (
  driveAccessToken: string,
  envelope: PassportFileEnvelopeV1,
) => Promise<PassportFileStoreResult<void>>;

type CreateVisibleRecoveryCopy = (
  driveAccessToken: string,
  envelope: PassportFileEnvelopeV1,
  publicKeyDisplay: string,
  signal: AbortSignal,
) => Promise<ResultType<void, unknown>>;

function failure<Success>(
  code: "drive_read_failed" | "unexpected_failure",
): GoogleBackedIdentityResult<Success> {
  return Result.err({ code });
}

function safeProgressReporter(
  reportProgress: ReportGoogleBackedIdentityProgress,
): ReportGoogleBackedIdentityProgress {
  return (progress) => {
    try {
      reportProgress(progress);
    } catch {
      LOGGER.warn("identity.google.progress_listener.failed");
    }
  };
}
