import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { decodeBase64Url } from "@/libs/encoding/base64Url";
import { isGoogleAccountProfile, type GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { isRecord } from "@/libs/typeGuards";
import { decodeFixedLengthBase64Url } from "@/client/logic/crypto/webCryptoPrimitives";
import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";
import {
  KEY_LOCK_BYTES,
  KEY_LOCK_LIMITS,
  type KeyLockFormatResult,
  type KeyLockParseErrorCode,
  type KeyLockSerializeErrorCode,
  type KeyLockStatus,
} from "./keyLockFormat";

const textEncoder = new TextEncoder();
const fixedBytes = (length: number) =>
  z.string().refine((value) => decodeFixedLengthBase64Url(value, length) !== null);
const publicKey = z.string().refine(isPubkyPublicKey);
const lockedFrom = z.enum(["first_write", "migration"]);
const vaultStates = ["enrolling", "on", "disabling"] as const;
const ciphertextSchema = z.strictObject({
  iv: fixedBytes(KEY_LOCK_BYTES.iv),
  ct: fixedBytes(KEY_LOCK_BYTES.ciphertext),
});
const sealSchema = ciphertextSchema.extend({ vaultId: fixedBytes(KEY_LOCK_BYTES.id) });
const slotSchema = z.strictObject({
  slotId: fixedBytes(KEY_LOCK_BYTES.id),
  kind: z.literal("passkey"),
  credentialId: z.string().refine((value) => {
    const decoded = decodeBase64Url(value);
    return (
      decoded !== undefined &&
      decoded.byteLength >= KEY_LOCK_BYTES.credentialMin &&
      decoded.byteLength <= KEY_LOCK_BYTES.credentialMax
    );
  }),
  prfInput: fixedBytes(KEY_LOCK_BYTES.prf),
  label: z
    .string()
    .min(1)
    .refine((value) => utf8Length(value) <= KEY_LOCK_LIMITS.label),
  transports: z.array(z.enum(["internal", "hybrid", "usb", "nfc", "ble", "smart-card"])),
  attachment: z.enum(["platform", "cross-platform", "unknown"]),
  backupEligible: z.boolean(),
  backupState: z.boolean(),
  clientEngine: z.enum(["webkit", "other"]),
  wrappedDek: ciphertextSchema,
});
const pendingScrubSchema = z.strictObject({
  kind: z.enum(["identity", "draft"]),
  publicKeyZ32: publicKey,
  digest: fixedBytes(32),
});
const vaultSchema = z
  .strictObject({
    v: z.literal(2),
    state: z.enum(vaultStates),
    vaultId: fixedBytes(KEY_LOCK_BYTES.id),
    origin: z.string(),
    rpId: z.string().min(1).max(KEY_LOCK_LIMITS.rpId),
    createdAt: z.iso.datetime(),
    slots: z.tuple([slotSchema]),
    pendingScrub: z.array(pendingScrubSchema).max(KEY_LOCK_LIMITS.keys).optional(),
  })
  .refine(({ origin, rpId }) => validOrigin(origin, rpId));
const identitySchema = z.strictObject({
  v: z.literal(2),
  publicKeyZ32: publicKey,
  lockedFrom,
  seal: sealSchema,
  googleAccount: z
    .custom<GoogleAccountProfile>(
      (value) => isGoogleAccountProfile(value) && !value.pictureUrl?.startsWith("data:"),
    )
    .optional(),
  profileSetupRequired: z.literal(true).optional(),
  homeserverPubky: publicKey.optional(),
});
const draftSchema = z.strictObject({
  v: z.literal(2),
  publicKeyZ32: publicKey,
  lockedFrom,
  seal: sealSchema,
  homeserverPubky: publicKey,
  signupToken: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => value.trim().length > 0),
  step: z.enum(["password", "confirm"]),
  registrationStarted: z.literal(true).optional(),
});

export type KeyLockSeal = z.infer<typeof sealSchema>;
export type KeyLockPasskeySlot = z.infer<typeof slotSchema>;
export type KeyLockVaultRecord = z.infer<typeof vaultSchema>;
export type LockedIdentityRecord = z.infer<typeof identitySchema>;
export type LockedDraftRecord = z.infer<typeof draftSchema>;

/** Cached inline avatars are not carried into locked records; leave the source profile untouched. */
export function googleAccountForLockedStorage(profile: GoogleAccountProfile): GoogleAccountProfile {
  return profile.pictureUrl?.startsWith("data:") ? { ...profile, pictureUrl: null } : profile;
}

export function parseKeyLockVault(
  raw: string,
): KeyLockFormatResult<KeyLockVaultRecord, "newer" | "damaged"> {
  return parseRecord(raw, vaultSchema, KEY_LOCK_LIMITS.vault, "damaged", true);
}
export function parseLockedIdentity(
  raw: string,
): KeyLockFormatResult<LockedIdentityRecord, KeyLockParseErrorCode> {
  return parseRecord(raw, identitySchema, KEY_LOCK_LIMITS.record, "unknown_version");
}
export function parseLockedDraft(
  raw: string,
): KeyLockFormatResult<LockedDraftRecord, KeyLockParseErrorCode> {
  return parseRecord(raw, draftSchema, KEY_LOCK_LIMITS.record, "unknown_version");
}

export function serializeKeyLockVault(
  record: KeyLockVaultRecord,
): KeyLockFormatResult<string, KeyLockSerializeErrorCode> {
  try {
    if (record.pendingScrub && record.pendingScrub.length > KEY_LOCK_LIMITS.keys)
      return Result.err({ code: "too_many_keys" });
    return serializeRecord(record, vaultSchema, KEY_LOCK_LIMITS.vault);
  } catch {
    return Result.err({ code: "invalid_record" });
  }
}
export function serializeLockedIdentity(
  record: LockedIdentityRecord,
): KeyLockFormatResult<string, "invalid_record" | "record_too_large"> {
  return serializeRecord(record, identitySchema, KEY_LOCK_LIMITS.record);
}
export function serializeLockedDraft(
  record: LockedDraftRecord,
): KeyLockFormatResult<string, "invalid_record" | "record_too_large"> {
  return serializeRecord(record, draftSchema, KEY_LOCK_LIMITS.record);
}

export function lockedRecordStatus(
  record: LockedIdentityRecord | LockedDraftRecord,
  vaultId: string | null,
): Extract<KeyLockStatus, "locked" | "locked_from_now_on" | "other_passkey"> {
  if (record.seal.vaultId !== vaultId) return "other_passkey";
  return record.lockedFrom === "first_write" ? "locked" : "locked_from_now_on";
}

function parseRecord<T, UnknownCode extends "damaged" | "unknown_version">(
  raw: string,
  schema: z.ZodType<T>,
  cap: number,
  unknownCode: UnknownCode,
  vault = false,
): KeyLockFormatResult<T, "newer" | "damaged" | UnknownCode> {
  try {
    if (!withinCap(raw, cap)) return Result.err({ code: unknownCode });
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return Result.err({ code: unknownCode });
    if (isNewer(value, vault)) return Result.err({ code: "newer" });
    if (value.v !== 2) return Result.err({ code: unknownCode });
    const parsed = schema.safeParse(value);
    return parsed.success ? Result.ok(parsed.data) : Result.err({ code: "damaged" });
  } catch {
    // Invalid stored values and parser diagnostics may contain secrets; retain neither.
    return Result.err({ code: unknownCode });
  }
}

function serializeRecord<T>(
  record: T,
  schema: z.ZodType<T>,
  cap: number,
): KeyLockFormatResult<string, "invalid_record" | "record_too_large"> {
  try {
    const parsed = schema.safeParse(record);
    if (!parsed.success) return Result.err({ code: "invalid_record" });
    const raw = JSON.stringify(parsed.data);
    return withinCap(raw, cap) ? Result.ok(raw) : Result.err({ code: "record_too_large" });
  } catch {
    return Result.err({ code: "invalid_record" });
  }
}

function withinCap(raw: string, cap: number): boolean {
  return raw.length <= cap && utf8Length(raw) <= cap;
}

function utf8Length(value: string): number {
  const bytes = textEncoder.encode(value);
  const length = bytes.byteLength;
  bytes.fill(0);
  return length;
}

function isNewer(value: Record<string, unknown>, vault: boolean): boolean {
  if (typeof value.v === "number" && Number.isInteger(value.v) && value.v !== 2) return true;
  if (!vault) return false;
  if (typeof value.state === "string" && !vaultStates.some((state) => state === value.state))
    return true;
  if (!Array.isArray(value.slots)) return false;
  if (value.slots.length !== 1) return true;
  const slot: unknown = value.slots[0];
  return isRecord(slot) && typeof slot.kind === "string" && slot.kind !== "passkey";
}

function validOrigin(origin: string, rpId: string): boolean {
  try {
    const url = new URL(origin);
    // Localhost is the explicitly supported local WebAuthn test origin.
    return (
      origin === url.origin &&
      rpId === url.hostname &&
      (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost"))
    );
  } catch {
    return false;
  }
}
