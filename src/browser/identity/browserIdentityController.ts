import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";
import type { LocalIdentitySummary } from "./local-identity/application/localIdentity";

export type { LocalIdentitySummary } from "./local-identity/application/localIdentity";

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
  recoverablePublicIdentity?: PubkyPublicIdentity;
};

export type BrowserIdentityAction =
  | { kind: "establish" }
  | { kind: "delete"; expectedPublicKeyZ32: string };

export type BrowserIdentityActionValue =
  | { kind: "established"; source: "created" | "restored"; publicIdentity: PubkyPublicIdentity }
  | { kind: "deleted" };

export type BrowserIdentityActionResult = Result<BrowserIdentityActionValue, BrowserIdentityControllerError>;

export type GoogleSignInErrorCode =
  | "sign_in_unavailable"
  | "sign_in_failed"
  | "drive_consent_failed"
  | "drive_popup_closed"
  | "drive_popup_failed_to_open"
  | "drive_consent_timeout"
  | "drive_account_mismatch"
  | "drive_account_verification_failed";

export type GoogleSignInState = {
  stage: "sign-in" | "drive" | "submitting";
  errorCode: GoogleSignInErrorCode | null;
};

export type GoogleContinueResult =
  | { status: "credential_failed" }
  | { status: "busy" }
  | { status: "superseded" }
  | { status: "action_finished_after_unmount"; result: BrowserIdentityActionResult }
  | { status: "action_completed"; result: BrowserIdentityActionResult };

export type BrowserIdentityController = {
  list(): BrowserIdentityCatalogResult<BrowserIdentityList>;
  select(id: string): BrowserIdentityCatalogResult<void>;
  clear(): BrowserIdentityCatalogResult<void>;
  subscribe(listener: () => void): () => void;
  mountGoogleSignIn(target: HTMLElement, onState: (state: GoogleSignInState) => void): Promise<void>;
  unmountGoogleSignIn(): void;
  retryGoogleSignIn(): void;
  continueGoogle(action: BrowserIdentityAction): Promise<GoogleContinueResult>;
  dispose(): void;
};
