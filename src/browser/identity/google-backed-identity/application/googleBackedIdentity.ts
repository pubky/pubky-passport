import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../../core/identity/pubkyIdentity";
import type { PassportFileEnvelopeV1 } from "../../../../core/passport-file/passportFile";
import type {
  HomegateSignupInvitationErrorCode,
  HomeserverSignupInvitation,
} from "../../../homegate/application/homegateSignupInvitation";
import type { PassportFileStore } from "../../../passport-file/application/passportFileStore";

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
      code: Exclude<GoogleBackedIdentityErrorCode, "homeserver_signup_invitation_failed">;
      partialSetupPublicIdentity?: PubkyPublicIdentity;
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

export type CreateGoogleBackedIdentityInput = {
  invitation: HomeserverSignupInvitation;
  passportFileStore: Pick<PassportFileStore, "createPassportFile">;
  wrappingKey: string;
};

export type RestoreGoogleBackedIdentityInput = {
  envelope: PassportFileEnvelopeV1;
  wrappingKey: string;
};

export type GoogleDrivePassportFileDeletionErrorCode =
  | "wrapping_key_failed"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "drive_stale_file"
  | "drive_delete_failed"
  | "unexpected_failure";

export type GoogleDrivePassportFileDeletionResult = Result<void, { code: GoogleDrivePassportFileDeletionErrorCode }>;
