import "client-only";

import type { Result } from "better-result";
import type { CodedFailure } from "@/libs/result";

export const KEY_LOCK_STORAGE = {
  vault: "pubky-passport/key-lock/v2/vault",
  retiredPrefix: "pubky-passport/key-lock/v2/retired/",
  identityPrefix: "pubky-passport/local-identities/v2/identity/",
  draft: "pubky-passport/local-account-draft/v2",
} as const;
export const KEY_LOCK_WEB_LOCK = "pubky-passport/key-lock";
export const KEY_LOCK_BYTES = {
  id: 16,
  prf: 32,
  iv: 12,
  ciphertext: 48,
  credentialMin: 16,
  credentialMax: 1023,
} as const;
export const KEY_LOCK_LIMITS = {
  vault: 32 * 1024,
  record: 4 * 1024,
  keys: 200,
  field: 2048,
  label: 96,
  rpId: 253,
} as const;

export type KeyLockRecordKind = "identity" | "draft";
export type KeyLockStatus =
  "locked" | "locked_from_now_on" | "not_locked_yet" | "other_passkey" | "unreadable";
export type KeyLockParseErrorCode = "newer" | "damaged" | "unknown_version";
export type KeyLockSerializeErrorCode = "invalid_record" | "record_too_large" | "too_many_keys";
export type KeyLockFormatErrorCode =
  KeyLockParseErrorCode | KeyLockSerializeErrorCode | "invalid_encoding";
export type KeyLockFormatResult<T, Code extends KeyLockFormatErrorCode> = Result<
  T,
  CodedFailure<Code>
>;
