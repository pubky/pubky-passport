import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";
import type { LocalIdentitySummary } from "./local-identity/application/localIdentityModels";

export type { LocalIdentitySummary } from "./local-identity/application/localIdentityModels";

export type BrowserIdentityList = {
  activeIdentityId: string | null;
  identities: LocalIdentitySummary[];
};

export type BrowserIdentityCatalogErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "no_active_identity"
  | "storage_unavailable";

export type BrowserIdentityCatalogResult<T> = Result<T, { code: BrowserIdentityCatalogErrorCode }>;

export type BrowserIdentityControllerErrorCode =
  | "wrapping_key_failed"
  | "wrapping_key_rate_limited"
  | "wrapping_key_unavailable"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "create_failed"
  | "encrypt_failed"
  | "drive_create_conflict"
  | "drive_write_failed"
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed"
  | "signup_failed"
  | "signin_failed"
  | "discovery_failed"
  | "local_save_failed"
  | "drive_stale_file"
  | "drive_delete_failed"
  | "unexpected_failure";

export type BrowserIdentityControllerError = {
  code: BrowserIdentityControllerErrorCode;
  partialSetupPublicIdentity?: PubkyPublicIdentity;
};

export type GoogleBackedIdentityAction =
  | { kind: "establish_google_backed_identity" }
  | { kind: "delete_google_drive_passport_file"; expectedPublicKeyZ32: string };

export type GoogleBackedIdentityActionValue =
  | {
      kind: "google_backed_identity_established";
      establishmentMode: "created" | "restored";
      publicIdentity: PubkyPublicIdentity;
    }
  | { kind: "google_drive_passport_file_deleted" };

export type GoogleBackedIdentityActionResult = Result<GoogleBackedIdentityActionValue, BrowserIdentityControllerError>;

export type GoogleBackedIdentityActionErrorCode =
  | "sign_in_unavailable"
  | "sign_in_failed"
  | "google_drive_authorization_failed"
  | "google_drive_authorization_popup_closed"
  | "google_drive_authorization_popup_failed_to_open"
  | "google_drive_authorization_timeout"
  | "google_drive_authorization_account_mismatch"
  | "google_drive_authorization_account_verification_failed";

export type GoogleBackedIdentityActionState = {
  stage:
    | "google-sign-in"
    | "google-drive-authorization"
    | "requesting-google-drive-authorization"
    | "executing-action";
  errorCode: GoogleBackedIdentityActionErrorCode | null;
};

export type GoogleBackedIdentityActionDispatchResult =
  | { status: "google_authorization_failed" }
  | { status: "busy" }
  | { status: "superseded" }
  | { status: "action_finished_after_unmount"; result: GoogleBackedIdentityActionResult }
  | { status: "action_completed"; result: GoogleBackedIdentityActionResult };

export type BrowserIdentityController = {
  list(): BrowserIdentityCatalogResult<BrowserIdentityList>;
  select(id: string): BrowserIdentityCatalogResult<void>;
  clear(): BrowserIdentityCatalogResult<void>;
  subscribe(listener: () => void): () => void;
  mountGoogleSignIn(target: HTMLElement, onState: (state: GoogleBackedIdentityActionState) => void): Promise<void>;
  unmountGoogleSignIn(): void;
  retryGoogleSignIn(): void;
  continueGoogleBackedIdentityAction(
    action: GoogleBackedIdentityAction,
  ): Promise<GoogleBackedIdentityActionDispatchResult>;
  dispose(): void;
};
