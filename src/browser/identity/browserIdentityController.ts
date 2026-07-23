import "client-only";

import type { Result } from "better-result";

import type { LocalIdentitySummary } from "../../features/identity/localIdentity";
import type { PubkyPublicIdentity } from "../../features/identity/pubkyIdentity";
import type { GoogleBackedIdentityFlowErrorCode } from "./google/applicationContracts";
import type { DeleteGoogleBackedIdentityErrorCode } from "./google/deleteGoogleBackedIdentity";
import type { LocalIdentityRepositoryErrorCode } from "./localIdentityService";

export type BrowserIdentityList = {
  activeIdentityId: string | null;
  identities: LocalIdentitySummary[];
};

export type BrowserIdentityRepositoryErrorCode = LocalIdentityRepositoryErrorCode;

export type BrowserIdentityControllerErrorCode =
  | GoogleBackedIdentityFlowErrorCode
  | DeleteGoogleBackedIdentityErrorCode;

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
