import "client-only";

import type { Result } from "better-result";

import type { LocalIdentitySummary } from "../../features/identity/localIdentity";
import type { PubkyPublicIdentity } from "../../features/identity/pubkyIdentity";

export type BrowserIdentityList = {
  activeIdentityId: string | null;
  identities: LocalIdentitySummary[];
};

export type BrowserIdentityRepositoryErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "no_active_identity"
  | "storage_unavailable";

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
  | "homegate_invite_failed"
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

export type GoogleSignInState = {
  stage: "sign-in" | "drive" | "submitting";
  error: string | null;
};

export type GoogleContinueResult =
  | { status: "credential_failed" }
  | { status: "action_completed"; result: BrowserIdentityActionResult };

export type BrowserIdentityController = {
  list(): Result<BrowserIdentityList, { code: BrowserIdentityRepositoryErrorCode }>;
  select(id: string): Result<void, { code: BrowserIdentityRepositoryErrorCode }>;
  clear(): Result<void, { code: BrowserIdentityRepositoryErrorCode }>;
  mountGoogleSignIn(target: HTMLElement, onState: (state: GoogleSignInState) => void): Promise<void>;
  unmountGoogleSignIn(): void;
  retryGoogleSignIn(): void;
  continueGoogle(action: BrowserIdentityAction): Promise<GoogleContinueResult>;
  dispose(): void;
};
