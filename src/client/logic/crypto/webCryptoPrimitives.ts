import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url } from "@/libs/encoding/base64Url";
import type { CodedFailure } from "@/libs/result";

type WebCryptoErrorCode = "unsupported_browser_crypto" | "encrypt_failed" | "decrypt_failed";
type CryptoResult<Value, Code extends WebCryptoErrorCode> = ResultType<Value, CodedFailure<Code>>;
type AesGcmParameters = { iv: Uint8Array; additionalData: Uint8Array };

export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;

/** Probes SubtleCrypto only; callers needing randomness must also check getRandomValues. */
export function getBrowserCrypto(): CryptoResult<
  { crypto: Crypto; subtle: SubtleCrypto },
  "unsupported_browser_crypto"
> {
  try {
    const crypto = globalThis.crypto;
    const subtle = crypto?.subtle;
    return crypto && subtle
      ? Result.ok({ crypto, subtle })
      : Result.err({ code: "unsupported_browser_crypto" });
  } catch (e) {
    return Result.err({ code: "unsupported_browser_crypto", cause: e });
  }
}

/** Copies just this view; the caller owns and must clear any sensitive bytes in the copy. */
export function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

/** Canonical unpadded base64url of exactly n bytes; checks length before decoding, else null. */
export function decodeFixedLengthBase64Url(
  value: string,
  expectedByteLength: number,
): Uint8Array | null {
  if (value.length !== Math.ceil((expectedByteLength * 4) / 3)) return null;
  const decoded = decodeBase64Url(value);
  return decoded?.byteLength === expectedByteLength ? decoded : null;
}

/**
 * Consumes ikm: both it and the import copy are cleared as soon as import settles.
 * Callers supply code-defined domain separation and usages, never stored algorithm/KDF options.
 */
export async function deriveAesGcmKeyWithHkdf(
  subtle: SubtleCrypto,
  ikm: Uint8Array,
  options: { salt: Uint8Array; info: Uint8Array; usages: KeyUsage[] },
): Promise<CryptoResult<CryptoKey, "unsupported_browser_crypto">> {
  try {
    let hkdfKey: CryptoKey;
    let material: ArrayBuffer | undefined;
    try {
      material = copyToArrayBuffer(ikm);
      hkdfKey = await subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
    } finally {
      if (material) new Uint8Array(material).fill(0);
      ikm.fill(0);
    }
    return Result.ok(
      await subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: copyToArrayBuffer(options.salt),
          info: copyToArrayBuffer(options.info),
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        options.usages,
      ),
    );
  } catch (e) {
    return Result.err({ code: "unsupported_browser_crypto", cause: e });
  }
}

/**
 * The caller owns plaintext; the temporary copy is cleared on every path.
 * iv must be 12 fresh random bytes, never reused under this key.
 */
async function aesGcmEncrypt(
  subtle: SubtleCrypto,
  key: CryptoKey,
  plaintext: Uint8Array,
  parameters: AesGcmParameters,
): Promise<CryptoResult<Uint8Array, "encrypt_failed">> {
  let copy: ArrayBuffer | undefined;
  try {
    if (parameters.iv.byteLength !== AES_GCM_IV_BYTES)
      return Result.err({ code: "encrypt_failed" });
    copy = copyToArrayBuffer(plaintext);
    return Result.ok(new Uint8Array(await subtle.encrypt(aesGcmParameters(parameters), key, copy)));
  } catch (e) {
    return Result.err({ code: "encrypt_failed", cause: e });
  } finally {
    if (copy) new Uint8Array(copy).fill(0);
  }
}

/** Draws a fresh IV for each encryption; contains random-source failures as encrypt_failed. */
export async function aesGcmEncryptWithRandomIv(
  crypto: Pick<Crypto, "getRandomValues">,
  subtle: SubtleCrypto,
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData: Uint8Array,
): Promise<CryptoResult<{ iv: Uint8Array; ciphertext: Uint8Array }, "encrypt_failed">> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const encrypted = await aesGcmEncrypt(subtle, key, plaintext, { iv, additionalData });
    return Result.isError(encrypted)
      ? Result.err(encrypted.error)
      : Result.ok({ iv, ciphertext: encrypted.value });
  } catch (e) {
    return Result.err({ code: "encrypt_failed", cause: e });
  }
}

/** Successful plaintext is caller-owned sensitive material and must be cleared after use. */
export async function aesGcmDecrypt(
  subtle: SubtleCrypto,
  key: CryptoKey,
  ciphertext: Uint8Array,
  parameters: AesGcmParameters,
): Promise<CryptoResult<Uint8Array, "decrypt_failed">> {
  try {
    if (parameters.iv.byteLength !== AES_GCM_IV_BYTES)
      return Result.err({ code: "decrypt_failed" });
    return Result.ok(
      new Uint8Array(
        await subtle.decrypt(aesGcmParameters(parameters), key, copyToArrayBuffer(ciphertext)),
      ),
    );
  } catch (e) {
    return Result.err({ code: "decrypt_failed", cause: e });
  }
}

function aesGcmParameters({ iv, additionalData }: AesGcmParameters): AesGcmParams {
  return {
    name: "AES-GCM",
    iv: copyToArrayBuffer(iv),
    additionalData: copyToArrayBuffer(additionalData),
    tagLength: AES_GCM_TAG_BYTES * 8,
  };
}
