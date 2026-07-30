import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../../core/identity/pubkyIdentity";
import type {
  HomegateSignupInvitationErrorCode,
} from "../../../homegate/application/homegateSignupInvitation";
import type { GoogleWrappingKeyErrorCode } from "../../../wrapping-key/wrappingKeyApiClient";

export type GoogleBackedIdentityCredentials = {
  googleIdToken: string;
  driveAccessToken: string;
};

export type GoogleBackedIdentityErrorCode =
  | "wrapping_key_failed"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "create_failed"
  | "encrypt_failed"
  | "drive_create_conflict"
  | "drive_write_failed"
  | "homeserver_signup_invitation_failed"
  | "signup_failed"
  | "signin_failed"
  | "discovery_failed"
  | "local_save_failed"
  | "unexpected_failure";

export type GoogleBackedIdentityError =
  | {
      code: Exclude<
        GoogleBackedIdentityErrorCode,
        "homeserver_signup_invitation_failed" | "wrapping_key_failed"
      >;
      partialSetupPublicIdentity?: PubkyPublicIdentity;
    }
  | {
      code: "wrapping_key_failed";
      cause: GoogleWrappingKeyErrorCode;
      partialSetupPublicIdentity?: never;
    }
  | {
      code: "homeserver_signup_invitation_failed";
      cause: HomegateSignupInvitationErrorCode;
      partialSetupPublicIdentity?: never;
    };

export type GoogleBackedIdentity = {
  establishmentMode: "restored" | "created";
  publicIdentity: PubkyPublicIdentity;
};
export type GoogleBackedIdentityResult<T> = Result<T, GoogleBackedIdentityError>;

export type GoogleDrivePassportFileDeletionErrorCode =
  | "wrapping_key_failed"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "drive_stale_file"
  | "drive_delete_failed"
  | "unexpected_failure";

export type GoogleDrivePassportFileDeletionError =
  | {
      code: Exclude<GoogleDrivePassportFileDeletionErrorCode, "wrapping_key_failed">;
    }
  | {
      code: "wrapping_key_failed";
      cause: GoogleWrappingKeyErrorCode;
    };

export type GoogleDrivePassportFileDeletionResult = Result<void, GoogleDrivePassportFileDeletionError>;
