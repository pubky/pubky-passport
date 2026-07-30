import "client-only";

import { Result } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../core/passport-file/passportFile";
import { decodeBase64Url, encodeBase64Url } from "../../libs/encoding/base64Url";
import type {
  DecryptPassportSecretInput,
  EncryptPassportSecretInput,
  PassportFileCryptoErrorCode,
  PassportFileCryptoResult,
} from "./passportFileCryptoResults";
import { normalizePassportFileOrigin, parsePassportFileEnvelope } from "../../core/passport-file/parsePassportFile";
import { PUBKY_SECRET_KEY_BYTES } from "../pubky/pubkyIdentityKey";

export type WebCryptoPassportFileCryptoOptions = {
  subtle?: SubtleCrypto | null;
  getRandomValues?: RandomValuesProvider | null;
};

type RandomValuesProvider = <T extends ArrayBufferView | null>(array: T) => T;

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

export class WebCryptoPassportFileCrypto {
  readonly #subtle: SubtleCrypto | null | undefined;
  readonly #getRandomValues: RandomValuesProvider | null | undefined;

  constructor(options: WebCryptoPassportFileCryptoOptions = {}) {
    const crypto = globalThis.crypto;

    this.#subtle = options.subtle === undefined ? crypto?.subtle : options.subtle;
    this.#getRandomValues =
      options.getRandomValues === undefined && typeof crypto?.getRandomValues === "function"
        ? crypto.getRandomValues.bind(crypto)
        : options.getRandomValues;
  }

  async encryptSecretKeyBytes(input: EncryptPassportSecretInput): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>> {
    const webCrypto = this.#getRequiredWebCrypto();
    if (Result.isError(webCrypto)) {
      return failure(webCrypto.error.code);
    }

    if (!isValidSecretKeyBytes(input.secretKeyBytes)) {
      return failure("invalid_plaintext");
    }

    const origin = normalizePassportFileOrigin(input.passportOrigin);
    if (Result.isError(origin)) {
      return failure("invalid_envelope");
    }

    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (Result.isError(wrappingBytes)) {
      return failure(wrappingBytes.error.code);
    }

    const wrappingMaterial = wrappingBytes.value;
    try {
      const envelopeMetadata = { v: 1 as const, url: origin.value };
      const key = await this.#deriveAesGcmKey(webCrypto.value.subtle, wrappingMaterial);
      if (Result.isError(key)) {
        return failure(key.error.code);
      }

      const iv = webCrypto.value.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
      const ciphertext = await webCrypto.value.subtle.encrypt(
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
      return failure("encrypt_failed");
    } finally {
      wrappingMaterial.fill(0);
    }
  }

  async decryptSecretKeyBytes(input: DecryptPassportSecretInput): Promise<PassportFileCryptoResult<Uint8Array>> {
    const webCrypto = this.#getRequiredWebCrypto();
    if (Result.isError(webCrypto)) {
      return failure(webCrypto.error.code);
    }

    const envelope = parsePassportFileEnvelope(input.envelope);
    if (Result.isError(envelope)) {
      return failure("invalid_envelope");
    }

    const expectedOrigin = normalizePassportFileOrigin(input.passportOrigin);
    if (Result.isError(expectedOrigin) || expectedOrigin.value !== envelope.value.url) {
      return failure("invalid_envelope");
    }

    const iv = decodeFixedLengthBase64Url(envelope.value.iv, AES_GCM_IV_BYTES);
    if (Result.isError(iv)) {
      return failure("invalid_envelope");
    }

    const ciphertext = decodeFixedLengthBase64Url(envelope.value.ct, AES_GCM_CIPHERTEXT_BYTES);
    if (Result.isError(ciphertext)) {
      return failure("invalid_envelope");
    }

    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (Result.isError(wrappingBytes)) {
      return failure(wrappingBytes.error.code);
    }

    const wrappingMaterial = wrappingBytes.value;
    try {
      const key = await this.#deriveAesGcmKey(webCrypto.value.subtle, wrappingMaterial);
      if (Result.isError(key)) {
        return failure(key.error.code);
      }

      const plaintext = await webCrypto.value.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv.value), additionalData: aadForEnvelope(envelope.value) },
        key.value,
        toArrayBuffer(ciphertext.value),
      );

      const secretKeyBytes = new Uint8Array(plaintext);
      if (!isValidSecretKeyBytes(secretKeyBytes)) {
        secretKeyBytes.fill(0);
        return failure("invalid_plaintext");
      }

      return Result.ok(secretKeyBytes);
    } catch {
      return failure("decrypt_failed");
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
      return failure("unsupported_browser_crypto");
    }

    return Result.ok({ subtle: this.#subtle, getRandomValues: this.#getRandomValues });
  }

  async #deriveAesGcmKey(subtle: SubtleCrypto, wrappingBytes: Uint8Array): Promise<PassportFileCryptoResult<CryptoKey>> {
    try {
      const hkdfKey = await subtle.importKey("raw", toArrayBuffer(wrappingBytes), "HKDF", false, ["deriveKey"]);

      const key = await subtle.deriveKey(
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
      );

      return Result.ok(key);
    } catch {
      return failure("unsupported_browser_crypto");
    }
  }
}

function isValidSecretKeyBytes(secretKeyBytes: Uint8Array): boolean {
  return secretKeyBytes instanceof Uint8Array && secretKeyBytes.byteLength === PUBKY_SECRET_KEY_BYTES;
}

function decodeWrappingKey(value: string): PassportFileCryptoResult<Uint8Array> {
  const decoded = decodeBase64Url(value);
  if (!decoded || decoded.byteLength !== WRAPPING_KEY_BYTES) {
    return failure("invalid_wrapping_key");
  }

  return Result.ok(decoded);
}

function decodeFixedLengthBase64Url(value: string, expectedByteLength: number): PassportFileCryptoResult<Uint8Array> {
  if (value.length !== base64UrlLength(expectedByteLength)) {
    return failure("invalid_envelope");
  }

  const decoded = decodeBase64Url(value);
  if (!decoded || decoded.byteLength !== expectedByteLength) {
    return failure("invalid_envelope");
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
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
}

function failure<T>(code: PassportFileCryptoErrorCode): PassportFileCryptoResult<T> {
  return Result.err({ code });
}
