import "client-only";

import type { Result } from "better-result";

declare const pubkyIdentityKeyHandleBrand: unique symbol;

export const PUBKY_SECRET_KEY_BYTES = 32;
export const PUBKY_SECRET_KEY_FORMAT = "pubky-secret-key";

/** Public metadata derived from a browser-owned Pubky keypair. */
export type PubkyPublicIdentity = {
  publicKeyZ32: string;
  publicKeyDisplay: string;
};

export type PubkyHomeserverResolutionResult = Result<
  string | null,
  { code: "invalid_pubky" | "resolution_failed" }
>;

export type PubkyIdentityKeyHandle = {
  readonly [pubkyIdentityKeyHandleBrand]: "PubkyIdentityKeyHandle";
};

export type PubkyIdentityKey = {
  keyHandle: PubkyIdentityKeyHandle;
  publicIdentity: PubkyPublicIdentity;
};

export type PubkySecretKeyMaterial = {
  bytes: Uint8Array;
  format: typeof PUBKY_SECRET_KEY_FORMAT;
};

export type PubkyIdentityKeysErrorCode =
  | "create_failed"
  | "export_failed"
  | "invalid_secret_key"
  | "key_unavailable"
  | "public_identity_failed"
  | "restore_failed";

export type PubkyIdentityKeysResult<Success> = Result<Success, { code: PubkyIdentityKeysErrorCode }>;
