import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../../../core/identity/pubkyIdentity";
import type { PassportFileEnvelopeV1 } from "../../../../../core/passport-file/passportFile";
import type { PassportFileStore } from "../../../../passport-file/ports";

export type GoogleIdentitySession = {
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
  | "homegate_invite_failed"
  | "signup_failed"
  | "signin_failed"
  | "discovery_failed"
  | "local_save_failed"
  | "unexpected_failure";

export type GoogleBackedIdentityError = {
  code: GoogleBackedIdentityErrorCode;
  recoverablePublicIdentity?: PubkyPublicIdentity;
};

export type GoogleBackedIdentity = {
  source: "restored" | "created";
  publicIdentity: PubkyPublicIdentity;
};
export type GoogleBackedIdentityResult<T> = Result<T, GoogleBackedIdentityError>;

export type GoogleIdentityEstablisher = {
  establish(google: GoogleIdentitySession): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>>;
};

export type GoogleDriveIdentityRestorer = {
  execute(input: {
    envelope: PassportFileEnvelopeV1;
    wrappingKey: string;
  }): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>>;
};

export type GoogleDriveIdentityCreator = {
  execute(input: {
    googleIdToken: string;
    passportFiles: Pick<PassportFileStore, "createPassportFile">;
    wrappingKey: string;
  }): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>>;
};

export type GoogleDriveIdentityDeletionErrorCode =
  | "wrapping_key_failed"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "drive_stale_file"
  | "drive_delete_failed"
  | "unexpected_failure";

export type GoogleDriveIdentityDeletionResult = Result<void, { code: GoogleDriveIdentityDeletionErrorCode }>;

export type GoogleDriveIdentityDeleter = {
  execute(
    google: GoogleIdentitySession,
    expectedPublicKeyZ32: string,
  ): Promise<GoogleDriveIdentityDeletionResult>;
};
