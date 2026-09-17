import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url, encodeBase64Url } from "@/libs/encoding/base64Url";
import { createFailure } from "@/libs/logger/createFailure";
import { safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import { PUBKY_SECRET_KEY_BYTES } from "@/client/logic/pubky/pubkyIdentityKey";
import {
  normalizePassportFileOrigin,
  parsePassportFileEnvelope,
  type PassportFileEnvelope,
} from "./passportFileEnvelope";

type CryptoErrorCode =
  | "unsupported_browser_crypto"
  | "invalid_wrapping_key"
  | "invalid_plaintext"
  | "invalid_envelope"
  | "encrypt_failed"
  | "decrypt_failed";

type CryptoResult<Success> = ResultType<Success, CodedFailure<CryptoErrorCode>>;
type BrowserCrypto = { crypto: Crypto; subtle: SubtleCrypto };
type BrowserCryptoResult = ResultType<BrowserCrypto, CodedFailure<"unsupported_browser_crypto">>;

const WRAPPING_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const AES_GCM_CIPHERTEXT_BYTES = PUBKY_SECRET_KEY_BYTES + AES_GCM_TAG_BITS / 8;
const TEXT_ENCODER = new TextEncoder();

const AES_GCM_DERIVATION_SALT = TEXT_ENCODER.encode("pubky-passport/passport-file/aes-gcm/salt/v1");
const AES_GCM_DERIVATION_INFO = TEXT_ENCODER.encode("passport-file:aes-gcm:v1");

/**
 * Encrypts and decrypts the 32-byte Pubky secret stored in a v1 Passport file.
 *
 * The wrapping key is expanded with HKDF-SHA-256 into a non-extractable
 * AES-256-GCM key. The envelope version and normalized Passport origin are
 * authenticated as additional data. Operational failures retain their original
 * causes, while logs expose only safe classifications and never key material.
 */
export class PassportFileWebCrypto {
  /**
   * Encrypts exactly 32 secret bytes with a fresh 96-bit IV and returns a
   * normalized v1 envelope. The caller retains ownership of the input bytes and
   * must clear them after this operation settles.
   */
  async encryptSecretKeyBytes(
    secretKeyBytes: Uint8Array,
    wrappingKey: string,
    passportOrigin: string,
    keyId: string,
  ): Promise<CryptoResult<PassportFileEnvelope>> {
    const browserCrypto = getBrowserCrypto();
    if (Result.isError(browserCrypto)) {
      return createFailure("passport_file.crypto.failed", browserCrypto.error, {
        operation: "encrypt",
        ...(browserCrypto.error.cause === undefined
          ? {}
          : safeErrorLogFields(browserCrypto.error.cause)),
      });
    }
    const { crypto, subtle } = browserCrypto.value;
    if (typeof crypto.getRandomValues !== "function") {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "unsupported_browser_crypto" },
        { operation: "encrypt" },
      );
    }

    if (!isValidSecretKeyBytes(secretKeyBytes)) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_plaintext" },
        { operation: "encrypt" },
      );
    }

    const origin = normalizePassportFileOrigin(passportOrigin);
    if (Result.isError(origin)) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_envelope", cause: origin.error },
        {
          operation: "encrypt",
        },
      );
    }

    const wrappingMaterial = decodeFixedLengthBase64Url(wrappingKey, WRAPPING_KEY_BYTES);
    if (!wrappingMaterial) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_wrapping_key" },
        { operation: "encrypt" },
      );
    }

    const plaintext = copyToArrayBuffer(secretKeyBytes);
    try {
      const key = await this.deriveAesGcmKey(subtle, wrappingMaterial);
      if (Result.isError(key)) {
        return createFailure("passport_file.crypto.failed", key.error, {
          operation: "encrypt",
          ...(key.error.cause === undefined ? {} : safeErrorLogFields(key.error.cause)),
        });
      }

      const iv = new Uint8Array(AES_GCM_IV_BYTES);
      crypto.getRandomValues(iv);
      const ciphertext = await subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: createEnvelopeAdditionalData(keyId, origin.value),
          tagLength: AES_GCM_TAG_BITS,
        },
        key.value,
        plaintext,
      );

      return Result.ok({
        v: 1,
        keyId,
        iv: encodeBase64Url(iv),
        ct: encodeBase64Url(new Uint8Array(ciphertext)),
        url: origin.value,
      });
    } catch (e) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "encrypt_failed", cause: e },
        {
          operation: "encrypt",
          ...safeErrorLogFields(e),
        },
      );
    } finally {
      clearArrayBuffer(plaintext);
      wrappingMaterial.fill(0);
    }
  }

  /**
   * Authenticates and decrypts a v1 envelope for the expected Passport origin.
   * The returned 32-byte secret is caller-owned sensitive material and must be
   * cleared when no longer needed.
   */
  async decryptSecretKeyBytes(
    envelope: PassportFileEnvelope,
    wrappingKey: string,
    passportOrigin: string,
  ): Promise<CryptoResult<Uint8Array>> {
    const browserCrypto = getBrowserCrypto();
    if (Result.isError(browserCrypto)) {
      return createFailure("passport_file.crypto.failed", browserCrypto.error, {
        operation: "decrypt",
        ...(browserCrypto.error.cause === undefined
          ? {}
          : safeErrorLogFields(browserCrypto.error.cause)),
      });
    }
    const { subtle } = browserCrypto.value;

    const parsed = parsePassportFileEnvelope(envelope);
    if (Result.isError(parsed)) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_envelope", cause: parsed.error },
        {
          operation: "decrypt",
        },
      );
    }
    const parsedEnvelope = parsed.value;

    const expectedOrigin = normalizePassportFileOrigin(passportOrigin);
    if (Result.isError(expectedOrigin)) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_envelope", cause: expectedOrigin.error },
        {
          operation: "decrypt",
        },
      );
    }
    if (expectedOrigin.value !== parsedEnvelope.url) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_envelope" },
        { operation: "decrypt" },
      );
    }

    const iv = decodeFixedLengthBase64Url(parsedEnvelope.iv, AES_GCM_IV_BYTES);
    if (!iv) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_envelope" },
        { operation: "decrypt" },
      );
    }

    const ciphertext = decodeFixedLengthBase64Url(parsedEnvelope.ct, AES_GCM_CIPHERTEXT_BYTES);
    if (!ciphertext) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_envelope" },
        { operation: "decrypt" },
      );
    }

    const wrappingMaterial = decodeFixedLengthBase64Url(wrappingKey, WRAPPING_KEY_BYTES);
    if (!wrappingMaterial) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "invalid_wrapping_key" },
        { operation: "decrypt" },
      );
    }

    try {
      const key = await this.deriveAesGcmKey(subtle, wrappingMaterial);
      if (Result.isError(key)) {
        return createFailure("passport_file.crypto.failed", key.error, {
          operation: "decrypt",
          ...(key.error.cause === undefined ? {} : safeErrorLogFields(key.error.cause)),
        });
      }

      const plaintext = await subtle.decrypt(
        {
          name: "AES-GCM",
          iv: copyToArrayBuffer(iv),
          additionalData: createEnvelopeAdditionalData(parsedEnvelope.keyId, parsedEnvelope.url),
          tagLength: AES_GCM_TAG_BITS,
        },
        key.value,
        copyToArrayBuffer(ciphertext),
      );

      const secretKeyBytes = new Uint8Array(plaintext);
      if (!isValidSecretKeyBytes(secretKeyBytes)) {
        secretKeyBytes.fill(0);
        return createFailure(
          "passport_file.crypto.failed",
          { code: "invalid_plaintext" },
          { operation: "decrypt" },
        );
      }

      return Result.ok(secretKeyBytes);
    } catch (e) {
      return createFailure(
        "passport_file.crypto.failed",
        { code: "decrypt_failed", cause: e },
        {
          operation: "decrypt",
          ...safeErrorLogFields(e),
        },
      );
    } finally {
      wrappingMaterial.fill(0);
    }
  }

  private async deriveAesGcmKey(
    subtle: SubtleCrypto,
    wrappingBytes: Uint8Array,
  ): Promise<ResultType<CryptoKey, CodedFailure<"unsupported_browser_crypto">>> {
    const wrappingMaterial = copyToArrayBuffer(wrappingBytes);
    try {
      const hkdfKey = await subtle.importKey("raw", wrappingMaterial, "HKDF", false, ["deriveKey"]);

      return Result.ok(
        await subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: copyToArrayBuffer(AES_GCM_DERIVATION_SALT),
            info: copyToArrayBuffer(AES_GCM_DERIVATION_INFO),
          },
          hkdfKey,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    } catch (e) {
      return Result.err({ code: "unsupported_browser_crypto", cause: e });
    } finally {
      clearArrayBuffer(wrappingMaterial);
    }
  }
}

function getBrowserCrypto(): BrowserCryptoResult {
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

function isValidSecretKeyBytes(secretKeyBytes: Uint8Array): boolean {
  return (
    secretKeyBytes instanceof Uint8Array && secretKeyBytes.byteLength === PUBKY_SECRET_KEY_BYTES
  );
}

function decodeFixedLengthBase64Url(value: string, expectedByteLength: number): Uint8Array | null {
  if (value.length !== base64UrlLength(expectedByteLength)) return null;

  const decoded = decodeBase64Url(value);
  return decoded?.byteLength === expectedByteLength ? decoded : null;
}

function base64UrlLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

function createEnvelopeAdditionalData(keyId: string, url: string): ArrayBuffer {
  return copyToArrayBuffer(
    TEXT_ENCODER.encode(`pubky-passport/passport-file/v1\n${url}\n${keyId}`),
  );
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function clearArrayBuffer(buffer: ArrayBuffer): void {
  new Uint8Array(buffer).fill(0);
}
