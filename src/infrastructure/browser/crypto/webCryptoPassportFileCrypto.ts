import "client-only";

import { pubkySecretKeyBytes } from "../../../core/domain/identity/pubkyIdentity";
import type { PassportFileEnvelopeV1 } from "../../../core/domain/passport-file/passportFile";
import type {
  PassportFileCrypto,
  PassportFileCryptoErrorCode,
  PassportFileCryptoResult,
} from "../../../core/ports/passportFileCrypto";
import { normalizePassportFileOrigin, parsePassportFileEnvelope } from "../../../core/pipes/passport-file/parsePassportFile";

export type WebCryptoPassportFileCryptoOptions = {
  subtle?: SubtleCrypto | null;
  getRandomValues?: RandomValuesProvider | null;
};

type RandomValuesProvider = <T extends ArrayBufferView | null>(array: T) => T;

type RequiredWebCrypto = {
  subtle: SubtleCrypto;
  getRandomValues: RandomValuesProvider;
};

const wrappingKeyBytes = 32;
const aesGcmIvBytes = 12;
const aesGcmTagBytes = 16;
const aesGcmCiphertextBytes = pubkySecretKeyBytes + aesGcmTagBytes;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const textEncoder = new TextEncoder();

const aesGcmDerivationSalt = textEncoder.encode("pubky-passport/passport-file/aes-gcm/salt/v1");
const aesGcmDerivationInfo = textEncoder.encode("passport-file:aes-gcm:v1");

export class WebCryptoPassportFileCrypto implements PassportFileCrypto {
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

  async encryptSecretKeyBytes(input: {
    secretKeyBytes: Uint8Array;
    wrappingKey: string;
    passportUrl: string;
  }): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>> {
    const webCrypto = this.#getRequiredWebCrypto();
    if (!webCrypto.ok) {
      return webCrypto;
    }

    if (!isValidSecretKeyBytes(input.secretKeyBytes)) {
      return failure("invalid_plaintext");
    }

    const origin = normalizePassportFileOrigin(input.passportUrl);
    if (!origin.ok) {
      return failure("invalid_envelope");
    }

    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (!wrappingBytes.ok) {
      return wrappingBytes;
    }

    const wrappingMaterial = wrappingBytes.value;
    try {
      const envelopeMetadata = { v: 1 as const, url: origin.origin };
      const key = await this.#deriveAesGcmKey(webCrypto.value.subtle, wrappingMaterial);
      if (!key.ok) {
        return key;
      }

      const iv = webCrypto.value.getRandomValues(new Uint8Array(aesGcmIvBytes));
      const ciphertext = await webCrypto.value.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aadForEnvelope(envelopeMetadata) },
        key.value,
        toArrayBuffer(input.secretKeyBytes),
      );

      return {
        ok: true,
        value: {
          v: envelopeMetadata.v,
          iv: encodeBase64Url(iv),
          ct: encodeBase64Url(new Uint8Array(ciphertext)),
          url: envelopeMetadata.url,
        },
      };
    } catch {
      return failure("encrypt_failed");
    } finally {
      wrappingMaterial.fill(0);
    }
  }

  async decryptSecretKeyBytes(input: {
    envelope: PassportFileEnvelopeV1;
    wrappingKey: string;
  }): Promise<PassportFileCryptoResult<Uint8Array>> {
    const webCrypto = this.#getRequiredWebCrypto();
    if (!webCrypto.ok) {
      return webCrypto;
    }

    const envelope = parsePassportFileEnvelope(input.envelope);
    if (!envelope.ok) {
      return failure("invalid_envelope");
    }

    const iv = decodeFixedLengthBase64Url(envelope.envelope.iv, aesGcmIvBytes);
    if (!iv.ok) {
      return failure("invalid_envelope");
    }

    const ciphertext = decodeFixedLengthBase64Url(envelope.envelope.ct, aesGcmCiphertextBytes);
    if (!ciphertext.ok) {
      return failure("invalid_envelope");
    }

    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (!wrappingBytes.ok) {
      return wrappingBytes;
    }

    const wrappingMaterial = wrappingBytes.value;
    try {
      const key = await this.#deriveAesGcmKey(webCrypto.value.subtle, wrappingMaterial);
      if (!key.ok) {
        return key;
      }

      const plaintext = await webCrypto.value.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv.value), additionalData: aadForEnvelope(envelope.envelope) },
        key.value,
        toArrayBuffer(ciphertext.value),
      );

      const secretKeyBytes = new Uint8Array(plaintext);
      if (!isValidSecretKeyBytes(secretKeyBytes)) {
        return failure("invalid_plaintext");
      }

      return { ok: true, value: secretKeyBytes };
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

    return { ok: true, value: { subtle: this.#subtle, getRandomValues: this.#getRandomValues } };
  }

  async #deriveAesGcmKey(subtle: SubtleCrypto, wrappingBytes: Uint8Array): Promise<PassportFileCryptoResult<CryptoKey>> {
    try {
      const hkdfKey = await subtle.importKey("raw", toArrayBuffer(wrappingBytes), "HKDF", false, ["deriveKey"]);

      const key = await subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toArrayBuffer(aesGcmDerivationSalt),
          info: toArrayBuffer(aesGcmDerivationInfo),
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );

      return { ok: true, value: key };
    } catch {
      return failure("unsupported_browser_crypto");
    }
  }

}

function isValidSecretKeyBytes(secretKeyBytes: Uint8Array): boolean {
  return secretKeyBytes instanceof Uint8Array && secretKeyBytes.byteLength === pubkySecretKeyBytes;
}

function decodeWrappingKey(value: string): PassportFileCryptoResult<Uint8Array> {
  const decoded = decodeBase64Url(value);
  if (!decoded.ok || decoded.value.byteLength !== wrappingKeyBytes) {
    return failure("invalid_wrapping_key");
  }

  return decoded;
}

function decodeFixedLengthBase64Url(value: string, expectedByteLength: number): PassportFileCryptoResult<Uint8Array> {
  if (value.length !== base64UrlLength(expectedByteLength)) {
    return failure("invalid_envelope");
  }

  const decoded = decodeBase64Url(value);
  if (!decoded.ok || decoded.value.byteLength !== expectedByteLength) {
    return failure("invalid_envelope");
  }

  return decoded;
}

function base64UrlLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3) - (byteLength % 3 === 0 ? 0 : 1);
}

function aadForEnvelope(envelope: Pick<PassportFileEnvelopeV1, "v" | "url">): ArrayBuffer {
  return toArrayBuffer(textEncoder.encode(`pubky-passport/passport-file/v${envelope.v}\n${envelope.url}`));
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return globalThis.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
}

export function decodeBase64Url(value: string): PassportFileCryptoResult<Uint8Array> {
  if (value.length === 0 || !base64UrlPattern.test(value)) {
    return failure("invalid_envelope");
  }

  const paddedLength = Math.ceil(value.length / 4) * 4;
  const paddingLength = paddedLength - value.length;
  if (paddingLength === 3) {
    return failure("invalid_envelope");
  }

  const base64 = `${value}${"=".repeat(paddingLength)}`.replaceAll("-", "+").replaceAll("_", "/");

  try {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return { ok: true, value: bytes };
  } catch {
    return failure("invalid_envelope");
  }
}

function failure<T>(code: PassportFileCryptoErrorCode): PassportFileCryptoResult<T> {
  return { ok: false, error: { code } };
}
