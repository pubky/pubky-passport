import "client-only";

import type { Result } from "better-result";

import type { CodedFailure } from "../../../libs/result";

declare const pubkyIdentityKeyHandleBrand: unique symbol;

export const PUBKY_SECRET_KEY_BYTES = 32;
export const PUBKY_SECRET_KEY_FORMAT = "pubky-secret-key";
const PUBKY_PUBLIC_KEY_Z32_PATTERN = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{51}[yo]$/u;

/** Public metadata derived from a browser-owned Pubky keypair. */
export type PubkyPublicIdentity = {
  publicKeyZ32: string;
};

/** Validates the one canonical public-key value stored by the application. */
export function isPubkyPublicIdentity(value: unknown): value is PubkyPublicIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const identity = value as Record<string, unknown>;
  const keys = Object.keys(identity);
  if (keys.length !== 1 || !Object.hasOwn(identity, "publicKeyZ32")) {
    return false;
  }

  const publicKeyZ32 = identity.publicKeyZ32;
  return isPubkyPublicKey(publicKeyZ32);
}

export function isPubkyPublicKey(value: unknown): value is string {
  return typeof value === "string" && PUBKY_PUBLIC_KEY_Z32_PATTERN.test(value);
}

export function formatPubkyPublicKey(publicKeyZ32: string): string {
  return `pubky${publicKeyZ32}`;
}

export type PubkyHomeserverResolutionResult = Result<
  string | null,
  CodedFailure<"invalid_pubky" | "resolution_failed">
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

export type PubkyIdentityKeysResult<Success> = Result<Success, CodedFailure<PubkyIdentityKeysErrorCode>>;
