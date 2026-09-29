import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import {
  aesGcmDecrypt,
  aesGcmEncryptWithRandomIv,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  decodeFixedLengthBase64Url,
  deriveAesGcmKeyWithHkdf,
  getBrowserCrypto,
} from "@/client/logic/crypto/webCryptoPrimitives";
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

const WRAPPING_KEY_BYTES = 32;
const AES_GCM_CIPHERTEXT_BYTES = PUBKY_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES;
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
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "encrypt",
        ...(browserCrypto.error.cause === undefined
          ? {}
          : safeErrorLogFields(browserCrypto.error.cause)),
        code: browserCrypto.error.code,
      });
      return Result.err(browserCrypto.error);
    }
    const { crypto, subtle } = browserCrypto.value;
    if (typeof crypto.getRandomValues !== "function") {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "encrypt",
        code: "unsupported_browser_crypto",
      });
      return Result.err({ code: "unsupported_browser_crypto" });
    }

    if (!isValidSecretKeyBytes(secretKeyBytes)) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "encrypt",
        code: "invalid_plaintext",
      });
      return Result.err({ code: "invalid_plaintext" });
    }

    const origin = normalizePassportFileOrigin(passportOrigin);
    if (Result.isError(origin)) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "encrypt",
        code: "invalid_envelope",
      });
      return Result.err({ code: "invalid_envelope", cause: origin.error });
    }

    const wrappingMaterial = decodeFixedLengthBase64Url(wrappingKey, WRAPPING_KEY_BYTES);
    if (!wrappingMaterial) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "encrypt",
        code: "invalid_wrapping_key",
      });
      return Result.err({ code: "invalid_wrapping_key" });
    }

    let plaintext: Uint8Array | undefined;
    try {
      plaintext = Uint8Array.from(secretKeyBytes);
      const key = await derivePassportFileKey(subtle, wrappingMaterial);
      if (Result.isError(key)) {
        LOGGER.warn("passport_file.crypto.failed", {
          operation: "encrypt",
          ...(key.error.cause === undefined ? {} : safeErrorLogFields(key.error.cause)),
          code: key.error.code,
        });
        return Result.err(key.error);
      }

      const sealed = await aesGcmEncryptWithRandomIv(
        crypto,
        subtle,
        key.value,
        plaintext,
        createEnvelopeAdditionalData(keyId, origin.value),
      );
      if (Result.isError(sealed)) {
        LOGGER.warn("passport_file.crypto.failed", {
          operation: "encrypt",
          ...(sealed.error.cause === undefined ? {} : safeErrorLogFields(sealed.error.cause)),
          code: sealed.error.code,
        });
        return Result.err(sealed.error);
      }

      return Result.ok({
        v: 1,
        keyId,
        iv: encodeBase64Url(sealed.value.iv),
        ct: encodeBase64Url(sealed.value.ciphertext),
        url: origin.value,
      });
    } catch (e) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "encrypt",
        ...safeErrorLogFields(e),
        code: "encrypt_failed",
      });
      return Result.err({ code: "encrypt_failed", cause: e });
    } finally {
      plaintext?.fill(0);
      wrappingMaterial.fill(0);
    }
  }

  /**
   * Authenticates and decrypts a v1 envelope. The envelope's origin records which Passport wrote
   * it and is authenticated as additional data, but any origin holding the wrapping key may
   * decrypt. The returned 32-byte secret is caller-owned sensitive material and must be cleared
   * when no longer needed.
   */
  async decryptSecretKeyBytes(
    envelope: PassportFileEnvelope,
    wrappingKey: string,
  ): Promise<CryptoResult<Uint8Array>> {
    const browserCrypto = getBrowserCrypto();
    if (Result.isError(browserCrypto)) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "decrypt",
        ...(browserCrypto.error.cause === undefined
          ? {}
          : safeErrorLogFields(browserCrypto.error.cause)),
        code: browserCrypto.error.code,
      });
      return Result.err(browserCrypto.error);
    }
    const { subtle } = browserCrypto.value;

    const parsed = parsePassportFileEnvelope(envelope);
    if (Result.isError(parsed)) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "decrypt",
        code: "invalid_envelope",
      });
      return Result.err({ code: "invalid_envelope", cause: parsed.error });
    }
    const parsedEnvelope = parsed.value;

    const iv = decodeFixedLengthBase64Url(parsedEnvelope.iv, AES_GCM_IV_BYTES);
    if (!iv) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "decrypt",
        code: "invalid_envelope",
      });
      return Result.err({ code: "invalid_envelope" });
    }

    const ciphertext = decodeFixedLengthBase64Url(parsedEnvelope.ct, AES_GCM_CIPHERTEXT_BYTES);
    if (!ciphertext) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "decrypt",
        code: "invalid_envelope",
      });
      return Result.err({ code: "invalid_envelope" });
    }

    const wrappingMaterial = decodeFixedLengthBase64Url(wrappingKey, WRAPPING_KEY_BYTES);
    if (!wrappingMaterial) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "decrypt",
        code: "invalid_wrapping_key",
      });
      return Result.err({ code: "invalid_wrapping_key" });
    }

    try {
      const key = await derivePassportFileKey(subtle, wrappingMaterial);
      if (Result.isError(key)) {
        LOGGER.warn("passport_file.crypto.failed", {
          operation: "decrypt",
          ...(key.error.cause === undefined ? {} : safeErrorLogFields(key.error.cause)),
          code: key.error.code,
        });
        return Result.err(key.error);
      }

      const plaintext = await aesGcmDecrypt(subtle, key.value, ciphertext, {
        iv,
        additionalData: createEnvelopeAdditionalData(parsedEnvelope.keyId, parsedEnvelope.url),
      });
      if (Result.isError(plaintext)) {
        LOGGER.warn("passport_file.crypto.failed", {
          operation: "decrypt",
          ...(plaintext.error.cause === undefined ? {} : safeErrorLogFields(plaintext.error.cause)),
          code: plaintext.error.code,
        });
        return Result.err(plaintext.error);
      }

      const secretKeyBytes = plaintext.value;
      if (!isValidSecretKeyBytes(secretKeyBytes)) {
        secretKeyBytes.fill(0);
        LOGGER.warn("passport_file.crypto.failed", {
          operation: "decrypt",
          code: "invalid_plaintext",
        });
        return Result.err({ code: "invalid_plaintext" });
      }

      return Result.ok(secretKeyBytes);
    } catch (e) {
      LOGGER.warn("passport_file.crypto.failed", {
        operation: "decrypt",
        ...safeErrorLogFields(e),
        code: "decrypt_failed",
      });
      return Result.err({ code: "decrypt_failed", cause: e });
    } finally {
      wrappingMaterial.fill(0);
    }
  }
}

function isValidSecretKeyBytes(secretKeyBytes: Uint8Array): boolean {
  return (
    secretKeyBytes instanceof Uint8Array && secretKeyBytes.byteLength === PUBKY_SECRET_KEY_BYTES
  );
}

function createEnvelopeAdditionalData(keyId: string, url: string): Uint8Array {
  return TEXT_ENCODER.encode(`pubky-passport/passport-file/v1\n${url}\n${keyId}`);
}

function derivePassportFileKey(subtle: SubtleCrypto, wrappingMaterial: Uint8Array) {
  return deriveAesGcmKeyWithHkdf(subtle, wrappingMaterial, {
    salt: AES_GCM_DERIVATION_SALT,
    info: AES_GCM_DERIVATION_INFO,
    usages: ["encrypt", "decrypt"],
  });
}
