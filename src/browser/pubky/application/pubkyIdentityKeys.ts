import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";

declare const pubkyIdentityKeyHandleBrand: unique symbol;

export const pubkySecretKeyBytes = 32;
export const pubkySecretKeyFormat = "pubky-secret-key";

export type PubkyIdentityKeyHandle = {
  readonly [pubkyIdentityKeyHandleBrand]: "PubkyIdentityKeyHandle";
};

export type PubkyIdentityKey = {
  keyHandle: PubkyIdentityKeyHandle;
  publicIdentity: PubkyPublicIdentity;
};

export type PubkySecretKeyMaterial = {
  bytes: Uint8Array;
  format: typeof pubkySecretKeyFormat;
};

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
