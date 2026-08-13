import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url, encodeBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_BYTES } from "../pubky/pubkyIdentityKey";
import {
  normalizePassportFileOrigin,
  parsePassportFileEnvelope,
  type PassportFileEnvelopeV1,
} from "./passportFileEnvelope";

export type PassportFileCryptoErrorCode =
  | "unsupported_browser_crypto"
  | "invalid_wrapping_key"
  | "invalid_plaintext"
  | "invalid_envelope"
  | "encrypt_failed"
  | "decrypt_failed";

export type PassportFileCryptoResult<Success> = ResultType<Success, { code: PassportFileCryptoErrorCode }>;

export type EncryptPassportSecretInput = {
  secretKeyBytes: Uint8Array;
  wrappingKey: string;
  passportOrigin: string;
};

export type DecryptPassportSecretInput = {
  envelope: PassportFileEnvelopeV1;
  wrappingKey: string;
  passportOrigin: string;
};

export type EncryptPassportSecret = (
  input: EncryptPassportSecretInput,
) => Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>>;

export type DecryptPassportSecret = (
  input: DecryptPassportSecretInput,
) => Promise<PassportFileCryptoResult<Uint8Array>>;

export type PassportFileWebCryptoOptions = {
  subtle?: SubtleCrypto | null;
  getRandomValues?: RandomValuesProvider | null;
};

type RandomValuesProvider = (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

type RequiredWebCrypto = {
  subtle: SubtleCrypto;
  getRandomValues: RandomValuesProvider;
};

const WRAPPING_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_GCM_CIPHERTEXT_BYTES = PUBKY_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES;
const TEXT_ENCODER = new TextEncoder();

const AES_GCM_DERIVATION_SALT = TEXT_ENCODER.encode("pubky-passport/passport-file/aes-gcm/salt/v1");
const AES_GCM_DERIVATION_INFO = TEXT_ENCODER.encode("passport-file:aes-gcm:v1");

export class PassportFileWebCrypto {
  readonly #subtle: SubtleCrypto | null | undefined;
  readonly #getRandomValues: RandomValuesProvider | null | undefined;

  constructor(options: PassportFileWebCryptoOptions = {}) {
    const crypto = globalThis.crypto;

    this.#subtle = options.subtle === undefined ? crypto?.subtle : options.subtle;
    this.#getRandomValues =
      options.getRandomValues === undefined && typeof crypto?.getRandomValues === "function"
        ? (array) => crypto.getRandomValues(array)
        : options.getRandomValues;
  }

  async encryptSecretKeyBytes(input: EncryptPassportSecretInput): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>> {
    const webCrypto = this.#getRequiredWebCrypto();
    if (Result.isError(webCrypto)) return failure(webCrypto.error.code, "encrypt");

    if (!isValidSecretKeyBytes(input.secretKeyBytes)) return failure("invalid_plaintext", "encrypt");

    const origin = normalizePassportFileOrigin(input.passportOrigin);
    if (Result.isError(origin)) return failure("invalid_envelope", "encrypt");

    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (Result.isError(wrappingBytes)) return failure(wrappingBytes.error.code, "encrypt");

    const { subtle, getRandomValues } = webCrypto.value;
    const wrappingMaterial = wrappingBytes.value;
    try {
      const envelopeMetadata = { v: 1 as const, url: origin.value };
      const key = await this.#deriveAesGcmKey(subtle, wrappingMaterial);
      if (Result.isError(key)) return propagateCryptoFailure(key.error);

      const iv = getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
      const ciphertext = await subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aadForEnvelope(envelopeMetadata) },
        key.value,
        toArrayBuffer(input.secretKeyBytes),
      );

      return Result.ok({
        v: envelopeMetadata.v,
        iv: encodeBase64Url(iv),
        ct: encodeBase64Url(new Uint8Array(ciphertext)),
        url: envelopeMetadata.url,
      });
    } catch {
      return failure("encrypt_failed", "encrypt");
    } finally {
      wrappingMaterial.fill(0);
    }
  }

  async decryptSecretKeyBytes(input: DecryptPassportSecretInput): Promise<PassportFileCryptoResult<Uint8Array>> {
    const webCrypto = this.#getRequiredWebCrypto();
    if (Result.isError(webCrypto)) return failure(webCrypto.error.code, "decrypt");

    const envelope = parsePassportFileEnvelope(input.envelope);
    if (Result.isError(envelope)) return failure("invalid_envelope", "decrypt");
    const parsedEnvelope = envelope.value;

    const expectedOrigin = normalizePassportFileOrigin(input.passportOrigin);
    if (Result.isError(expectedOrigin) || expectedOrigin.value !== parsedEnvelope.url) return failure("invalid_envelope", "decrypt");

    const iv = decodeFixedLengthBase64Url(parsedEnvelope.iv, AES_GCM_IV_BYTES);
    if (Result.isError(iv)) return failure("invalid_envelope", "decrypt");

    const ciphertext = decodeFixedLengthBase64Url(parsedEnvelope.ct, AES_GCM_CIPHERTEXT_BYTES);
    if (Result.isError(ciphertext)) return failure("invalid_envelope", "decrypt");

    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (Result.isError(wrappingBytes)) return failure(wrappingBytes.error.code, "decrypt");

    const { subtle } = webCrypto.value;
    const wrappingMaterial = wrappingBytes.value;
    try {
      const key = await this.#deriveAesGcmKey(subtle, wrappingMaterial);
      if (Result.isError(key)) return propagateCryptoFailure(key.error);

      const plaintext = await subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv.value), additionalData: aadForEnvelope(parsedEnvelope) },
        key.value,
        toArrayBuffer(ciphertext.value),
      );

      const secretKeyBytes = new Uint8Array(plaintext);
      if (!isValidSecretKeyBytes(secretKeyBytes)) {
        secretKeyBytes.fill(0);
        return failure("invalid_plaintext", "decrypt");
      }

      return Result.ok(secretKeyBytes);
    } catch {
      return failure("decrypt_failed", "decrypt");
    } finally {
      wrappingMaterial.fill(0);
    }
  }

  #getRequiredWebCrypto(): PassportFileCryptoResult<RequiredWebCrypto> {
    if (
      !this.#subtle ||
      typeof this.#subtle.importKey !== "function" ||
      typeof this.#subtle.deriveKey !== "function" ||
      typeof this.#subtle.encrypt !== "function" ||
      typeof this.#subtle.decrypt !== "function" ||
      typeof this.#getRandomValues !== "function"
    ) {
      return cryptoError("unsupported_browser_crypto");
    }

    return Result.ok({ subtle: this.#subtle, getRandomValues: this.#getRandomValues });
  }

  async #deriveAesGcmKey(subtle: SubtleCrypto, wrappingBytes: Uint8Array): Promise<PassportFileCryptoResult<CryptoKey>> {
    try {
      const hkdfKey = await subtle.importKey("raw", toArrayBuffer(wrappingBytes), "HKDF", false, ["deriveKey"]);

      return Result.ok(await subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toArrayBuffer(AES_GCM_DERIVATION_SALT),
          info: toArrayBuffer(AES_GCM_DERIVATION_INFO),
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ));
    } catch {
      return failure("unsupported_browser_crypto", "derive_key");
    }
  }
}

function isValidSecretKeyBytes(secretKeyBytes: Uint8Array): boolean {
  return secretKeyBytes instanceof Uint8Array && secretKeyBytes.byteLength === PUBKY_SECRET_KEY_BYTES;
}

function decodeWrappingKey(value: string): PassportFileCryptoResult<Uint8Array> {
  const decoded = decodeBase64Url(value);
  if (!decoded || decoded.byteLength !== WRAPPING_KEY_BYTES) {
    return cryptoError("invalid_wrapping_key");
  }

  return Result.ok(decoded);
}

function decodeFixedLengthBase64Url(value: string, expectedByteLength: number): PassportFileCryptoResult<Uint8Array> {
  if (value.length !== base64UrlLength(expectedByteLength)) {
    return cryptoError("invalid_envelope");
  }

  const decoded = decodeBase64Url(value);
  if (!decoded || decoded.byteLength !== expectedByteLength) {
    return cryptoError("invalid_envelope");
  }

  return Result.ok(decoded);
}

function base64UrlLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3) - (byteLength % 3 === 0 ? 0 : 1);
}

function aadForEnvelope(envelope: { v: PassportFileEnvelopeV1["v"]; url: PassportFileEnvelopeV1["url"] }): ArrayBuffer {
  return toArrayBuffer(TEXT_ENCODER.encode(`pubky-passport/passport-file/v${envelope.v}\n${envelope.url}`));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function failure<Success>(code: PassportFileCryptoErrorCode, operation: CryptoOperation): PassportFileCryptoResult<Success> {
  logCryptoFailure(operation, code);
  return Result.err({ code });
}

function cryptoError<Success>(code: PassportFileCryptoErrorCode): PassportFileCryptoResult<Success> {
  return Result.err({ code });
}

function propagateCryptoFailure<Success>(error: { code: PassportFileCryptoErrorCode }): PassportFileCryptoResult<Success> {
  return Result.err(error);
}

function logCryptoFailure(
  operation: CryptoOperation,
  code: PassportFileCryptoErrorCode,
): void {
  LOGGER.warn("passport_file.crypto.failed", { operation, code });
}

type CryptoOperation = "encrypt" | "decrypt" | "derive_key";
