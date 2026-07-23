import "client-only";

import type { Result } from "better-result";

import type { ValidatedSensitivePubkyAuthRequest } from "../../features/auth/parsePubkyAuthRequest";
import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyIdentitySession,
  PubkyPublicIdentity,
  PubkySecretKeyMaterial,
} from "../../features/identity/pubkyIdentity";

export type PubkyIdentityKeysErrorCode =
  | "create_failed"
  | "export_failed"
  | "invalid_secret_key"
  | "key_unavailable"
  | "public_identity_failed"
  | "restore_failed";

export type PubkyIdentityKeysResult<T> = Result<T, { code: PubkyIdentityKeysErrorCode }>;

export type PubkyIdentityKeys = {
  createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  restoreIdentityKey(input: { secretKey: PubkySecretKeyMaterial }): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  disposeIdentityKey(input: { keyHandle: PubkyIdentityKeyHandle }): void;
  exportSecretKey(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>>;
  getPublicIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>>;
};

export type PubkySignupErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "signin_failed" | "signup_failed";
export type PubkySignupResult<T> = Result<T, { code: PubkySignupErrorCode }>;

export type PubkySignup = {
  signup(input: {
    keyHandle: PubkyIdentityKeyHandle;
    homeserverPubky: string;
    signupCode?: string | null;
  }): Promise<PubkySignupResult<PubkyIdentitySession>>;
  signin(input: { keyHandle: PubkyIdentityKeyHandle; waitForDiscovery?: boolean }): Promise<PubkySignupResult<PubkyIdentitySession>>;
};

export type PubkyDiscoveryErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "publish_failed";
export type PubkyDiscoveryResult = Result<void, { code: PubkyDiscoveryErrorCode }>;

export type PubkyDiscovery = {
  publishHomeserverIfStale(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult>;
  publishHomeserverForce(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult>;
};

export type PubkyAuthApprovalErrorCode = "approval_failed" | "key_unavailable" | "relay_failed" | "request_rejected";
export type PubkyAuthApprovalResult = Result<void, { code: PubkyAuthApprovalErrorCode }>;

export type PubkyAuthApproval = {
  approveAuthRequest(input: {
    keyHandle: PubkyIdentityKeyHandle;
    authRequest: ValidatedSensitivePubkyAuthRequest;
  }): Promise<PubkyAuthApprovalResult>;
};
