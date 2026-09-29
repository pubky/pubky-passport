import "client-only";

import { Result } from "better-result";

import { decodeFixedLengthBase64Url } from "@/client/logic/crypto/webCryptoPrimitives";
import {
  KEY_LOCK_BYTES,
  KEY_LOCK_LIMITS,
  type KeyLockFormatResult,
  type KeyLockRecordKind,
} from "./keyLockFormat";
import type { KeyLockPasskeySlot, KeyLockSeal, KeyLockVaultRecord } from "./keyLockRecords";

const textEncoder = new TextEncoder();

/** A rejected field is a programming error: authenticated fields must be bounded ASCII. */
export function enc(
  fields: readonly string[],
): KeyLockFormatResult<Uint8Array, "invalid_encoding"> {
  try {
    if (
      fields.some((field) => field.length > KEY_LOCK_LIMITS.field || /[^\x00-\x7f]/u.test(field))
    ) {
      return Result.err({ code: "invalid_encoding" });
    }
    const result = new Uint8Array(fields.reduce((size, field) => size + 2 + field.length, 0));
    const view = new DataView(result.buffer);
    let offset = 0;
    for (const field of fields) {
      view.setUint16(offset, field.length, false);
      textEncoder.encodeInto(field, result.subarray(offset + 2));
      offset += 2 + field.length;
    }
    return Result.ok(result);
  } catch {
    return Result.err({ code: "invalid_encoding" });
  }
}

export function createKekInfo(
  vault: Pick<KeyLockVaultRecord, "vaultId">,
  slot: Pick<KeyLockPasskeySlot, "slotId" | "credentialId">,
) {
  return enc(["pubky-passport/key-lock/kek", "v2", vault.vaultId, slot.slotId, slot.credentialId]);
}

export function createWrappedDekAdditionalData(
  vault: Pick<KeyLockVaultRecord, "origin" | "vaultId">,
  slot: Pick<KeyLockPasskeySlot, "slotId" | "credentialId" | "prfInput">,
) {
  return enc([
    "pubky-passport/key-lock/dek",
    "v2",
    vault.origin,
    vault.vaultId,
    slot.slotId,
    slot.credentialId,
    slot.prfInput,
    "hkdf-sha256",
  ]);
}

export function createSeedAdditionalData(
  vault: Pick<KeyLockVaultRecord, "origin" | "vaultId">,
  record: { kind: KeyLockRecordKind; publicKeyZ32: string },
) {
  return enc([
    "pubky-passport/key-lock/seed",
    "v2",
    vault.origin,
    vault.vaultId,
    record.kind,
    record.publicKeyZ32,
  ]);
}

/** The returned digest input contains the source record; the caller must clear it after hashing. */
export function createScrubDigestInput(
  seal: Pick<KeyLockSeal, "iv" | "ct">,
  sealedFrom: string,
): KeyLockFormatResult<Uint8Array, "invalid_encoding"> {
  let source: Uint8Array | undefined;
  try {
    if (!sealedFrom.isWellFormed()) return Result.err({ code: "invalid_encoding" });
    const iv = decodeFixedLengthBase64Url(seal.iv, KEY_LOCK_BYTES.iv);
    const ct = decodeFixedLengthBase64Url(seal.ct, KEY_LOCK_BYTES.ciphertext);
    if (!iv || !ct) return Result.err({ code: "invalid_encoding" });
    const label = textEncoder.encode("pubky-passport/key-lock/scrub-digest/v2\0");
    source = textEncoder.encode(sealedFrom);
    const input = new Uint8Array(label.length + iv.length + ct.length + source.length);
    input.set(label);
    input.set(iv, label.length);
    input.set(ct, label.length + iv.length);
    input.set(source, label.length + iv.length + ct.length);
    return Result.ok(input);
  } catch {
    return Result.err({ code: "invalid_encoding" });
  } finally {
    source?.fill(0);
  }
}
