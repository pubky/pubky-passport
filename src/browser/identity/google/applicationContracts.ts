import "client-only";

import type { Result } from "better-result";

import type { PubkyIdentityKey, PubkyPublicIdentity } from "../../../features/identity/pubkyIdentity";
import type { PassportFileEnvelopeV1 } from "../../../features/passport-file/passportFile";
import type { PassportFileStore } from "../../passport-file/ports";

export type GoogleIdentityProviderErrorCode =
  | "google_unavailable"
  | "sign_in_failed"
  | "drive_consent_failed"
  | "drive_popup_closed"
  | "drive_popup_failed_to_open"
  | "drive_consent_timeout"
  | "drive_consent_aborted"
  | "drive_account_verification_failed"
  | "drive_account_mismatch";

export type GoogleIdentityProviderResult<T> = Result<T, { code: GoogleIdentityProviderErrorCode }>;

export type GoogleIdentitySession = {
  googleIdToken: string;
  driveAccessToken: string;
};

export type GoogleBackedIdentityFlowErrorCode =
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

export type GoogleBackedIdentityFlowError = {
  code: GoogleBackedIdentityFlowErrorCode;
  recoverablePublicIdentity?: PubkyPublicIdentity;
};

export type GoogleBackedIdentity = PubkyIdentityKey & { source: "restored" | "created" };
export type GoogleBackedIdentityFlowResult<T> = Result<T, GoogleBackedIdentityFlowError>;

export type RestoreExistingGoogleDriveIdentity = {
  execute(input: {
    envelope: PassportFileEnvelopeV1;
    wrappingKey: string;
  }): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>>;
};

export type CreateMissingGoogleDriveIdentity = {
  execute(input: {
    googleIdToken: string;
    passportFiles: Pick<PassportFileStore, "createPassportFile">;
    wrappingKey: string;
  }): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>>;
};

export type HomeserverSignupInvitation = {
  signupCode: string;
  homeserverPubky: string;
};

export type GoogleHomegateInviteRequesterErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "invalid_response"
  | "network_failed";

export type GoogleHomegateInviteRequester = {
  requestSignupInvitation(input: {
    googleIdToken: string;
  }): Promise<Result<HomeserverSignupInvitation, { code: GoogleHomegateInviteRequesterErrorCode }>>;
};

export type GoogleWrappingKeyRequesterErrorCode =
  | "invalid_request"
  | "invalid_google_id_token"
  | "expired_google_id_token"
  | "unsupported_google_issuer"
  | "unsupported_google_audience"
  | "missing_google_subject"
  | "rate_limited"
  | "dependency_unavailable"
  | "internal_error"
  | "invalid_response"
  | "network_failed";

export type GoogleWrappingKeyRequester = {
  requestWrappingKey(input: {
    googleIdToken: string;
  }): Promise<Result<string, { code: GoogleWrappingKeyRequesterErrorCode }>>;
};
