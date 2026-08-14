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
import type { PubkyIdentityKey } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import type { GoogleWrappingKeyErrorCode, WrappingKeyApiClient } from "../../wrapping-key/wrappingKeyApiClient";
import type { PubkyPublicIdentity } from "../pubkyPublicIdentity";
import type {
  ActivateGoogleBackedIdentity,
  ActivateGoogleBackedIdentityErrorCode,
} from "./activateGoogleBackedIdentity";
import type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";
import type {
  ReportGoogleBackedIdentityProgress,
} from "./establishGoogleBackedIdentity";
import type { RestoredGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";
import type { RestoreGoogleBackedIdentityKey } from "./restoreGoogleBackedIdentityKey";

export type ResumeIncompleteGoogleBackedIdentityError =
  | {
    code: "wrapping_key_failed";
    cause: GoogleWrappingKeyErrorCode;
    preservedPassportFileIdentity: PubkyPublicIdentity;
  }
  | {
    code: "homeserver_signup_invitation_failed";
    cause: HomegateSignupInvitationErrorCode;
    preservedPassportFileIdentity: PubkyPublicIdentity;
  }
  | {
    code:
    | "drive_read_failed"
    | "decrypt_failed"
    | "restore_failed"
    | ActivateGoogleBackedIdentityErrorCode
    | "unexpected_failure";
    preservedPassportFileIdentity: PubkyPublicIdentity;
  };

export type ResumeIncompleteGoogleBackedIdentityResult = ResultType<
  RestoredGoogleBackedIdentity,
  ResumeIncompleteGoogleBackedIdentityError
>;

/** Restores a preserved Passport key and completes its interrupted homeserver signup. */
export class ResumeIncompleteGoogleBackedIdentity {
  constructor(private readonly dependencies: {
    requestWrappingKey: WrappingKeyApiClient["requestGoogleWrappingKey"];
    readPassportFile: ReadPassportFile;
    requestSignupInvitation: HomegateClient["requestGoogleHomeserverSignupInvitation"];
    restoreIdentityKey: RestoreGoogleBackedIdentityKey["execute"];
    activateIdentity: ActivateGoogleBackedIdentity["execute"];
    pubky: PubkySdkAdapter;
  }) {}

  async execute(
    credentials: GoogleBackedIdentityCredentials,
    expectedIdentity: PubkyPublicIdentity,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<ResumeIncompleteGoogleBackedIdentityResult> {
    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      reportProgress("preparing_secure_identity");
      LOGGER.info("identity.google.wrapping_key.started");
      const wrappingKey = await this.dependencies.requestWrappingKey(credentials.googleIdToken);
      if (Result.isError(wrappingKey)) {
        return wrappingKeyFailure(expectedIdentity, wrappingKey.error.code);
      }
      LOGGER.info("identity.google.wrapping_key.completed");

      reportProgress("checking_passport_file");
      LOGGER.info("identity.google.drive_read.started");
      const storedFile = await this.dependencies.readPassportFile(credentials.driveAccessToken);
      if (Result.isError(storedFile) || storedFile.value.status !== "found") {
        return failure("drive_read_failed", expectedIdentity);
      }
      LOGGER.info("identity.google.drive_read.completed", { status: "found" });

      reportProgress("restoring_identity");
      const restored = await this.dependencies.restoreIdentityKey(storedFile.value.envelope, wrappingKey.value);
      if (Result.isError(restored)) return failure(restored.error.code, expectedIdentity);
      restoredIdentity = restored.value;

      if (restoredIdentity.publicIdentity.publicKeyZ32 !== expectedIdentity.publicKeyZ32) {
        LOGGER.warn("identity.google.resume_identity.failed", { code: "identity_mismatch" });
        return failure("identity_mismatch", expectedIdentity);
      }

      LOGGER.info("identity.google.homeserver_signup_invitation.started");
      const invitation = await this.dependencies.requestSignupInvitation(credentials.googleIdToken);
      if (Result.isError(invitation)) {
        return invitationFailure(expectedIdentity, invitation.error.code);
      }
      LOGGER.info("identity.google.homeserver_signup_invitation.completed");

      const activated = await this.dependencies.activateIdentity(
        restoredIdentity,
        invitation.value,
        reportProgress,
        credentials.googleAccount,
      );
      if (Result.isError(activated)) return failure(activated.error.code, expectedIdentity);

      return Result.ok({
        establishmentMode: "restored",
        publicIdentity: restoredIdentity.publicIdentity,
      });
    } catch {
      LOGGER.warn("identity.google.resume.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure", expectedIdentity);
    } finally {
      if (restoredIdentity) {
        try {
          this.dependencies.pubky.disposeIdentityKey(restoredIdentity.keyHandle);
        } catch {
          LOGGER.warn("identity.google.cleanup.failed", { operation: "resumed_key_dispose" });
        }
      }
    }
  }
}

type ResumeFailureCode = ResumeIncompleteGoogleBackedIdentityError["code"];
type ReadPassportFile = (
  driveAccessToken: string,
) => Promise<PassportFileStoreResult<PassportFileReadResult>>;

function failure(
  code: Exclude<ResumeFailureCode, "wrapping_key_failed" | "homeserver_signup_invitation_failed">,
  preservedPassportFileIdentity: PubkyPublicIdentity,
): ResumeIncompleteGoogleBackedIdentityResult {
  return Result.err({
    code,
    preservedPassportFileIdentity,
  });
}

function wrappingKeyFailure(
  preservedPassportFileIdentity: PubkyPublicIdentity,
  cause: GoogleWrappingKeyErrorCode,
): ResumeIncompleteGoogleBackedIdentityResult {
  return Result.err({ code: "wrapping_key_failed", cause, preservedPassportFileIdentity });
}

function invitationFailure(
  preservedPassportFileIdentity: PubkyPublicIdentity,
  cause: HomegateSignupInvitationErrorCode,
): ResumeIncompleteGoogleBackedIdentityResult {
  return Result.err({
    code: "homeserver_signup_invitation_failed",
    cause,
    preservedPassportFileIdentity,
  });
}
