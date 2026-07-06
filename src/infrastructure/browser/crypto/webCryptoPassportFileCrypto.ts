import type { PassportFileEnvelopeV1 } from "../../../core/domain/passport-file/passportFile";
import type {
  PassportFileCrypto,
  PassportFileCryptoErrorCode,
  PassportFileCryptoResult,
} from "../../../core/ports/passportFileCrypto";
import { normalizePassportFileOrigin, parsePassportFileEnvelope } from "../../../core/pipes/passport-file/parsePassportFile";

export type WebCryptoPassportFileCryptoOptions = {
  subtle?: SubtleCrypto;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
};

const wrappingKeyBytes = 32;
const aesGcmIvBytes = 12;
const recoveryPassphraseBytes = 32;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const textEncoder = new TextEncoder();

const aesGcmDerivationSalt = textEncoder.encode("pubky-passport/passport-file/aes-gcm/salt/v1");
const aesGcmDerivationInfo = textEncoder.encode("passport-file:aes-gcm:v1");
const recoveryPassphraseDerivationSalt = textEncoder.encode("pubky-passport/pubky-recovery-passphrase/salt/v1");
const recoveryPassphraseDerivationInfo = textEncoder.encode("pubky-recovery-passphrase:v1");

export class WebCryptoPassportFileCrypto implements PassportFileCrypto {
  readonly #subtle: SubtleCrypto;
  readonly #getRandomValues: <T extends ArrayBufferView | null>(array: T) => T;

  constructor(options: WebCryptoPassportFileCryptoOptions = {}) {
    this.#subtle = options.subtle ?? globalThis.crypto.subtle;
    this.#getRandomValues = options.getRandomValues ?? globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  }

  async encryptRecoveryFileBytes(input: {
    recoveryFileBytes: Uint8Array;
    wrappingKey: string;
    passportUrl: string;
  }): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>> {
    if (!isValidRecoveryFileBytes(input.recoveryFileBytes)) {
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
      const key = await this.#deriveAesGcmKey(wrappingMaterial);
      const iv = this.#getRandomValues(new Uint8Array(aesGcmIvBytes));
      const ciphertext = await this.#subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aadForEnvelope(envelopeMetadata) },
        key,
        toArrayBuffer(input.recoveryFileBytes),
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

  async decryptRecoveryFileBytes(input: {
    envelope: PassportFileEnvelopeV1;
    wrappingKey: string;
  }): Promise<PassportFileCryptoResult<Uint8Array>> {
    const envelope = parsePassportFileEnvelope(input.envelope);
    if (!envelope.ok) {
      return failure("invalid_envelope");
    }

    const iv = decodeBase64Url(envelope.envelope.iv);
    if (!iv.ok || iv.value.byteLength !== aesGcmIvBytes) {
      return failure("invalid_envelope");
    }

    const ciphertext = decodeBase64Url(envelope.envelope.ct);
    if (!ciphertext.ok || ciphertext.value.byteLength === 0) {
      return failure("invalid_envelope");
    }

    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (!wrappingBytes.ok) {
      return wrappingBytes;
    }

    const wrappingMaterial = wrappingBytes.value;
    try {
      const key = await this.#deriveAesGcmKey(wrappingMaterial);
      const plaintext = await this.#subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv.value), additionalData: aadForEnvelope(envelope.envelope) },
        key,
        toArrayBuffer(ciphertext.value),
      );

      return { ok: true, value: new Uint8Array(plaintext) };
    } catch {
      return failure("decrypt_failed");
    } finally {
      wrappingMaterial.fill(0);
    }
  }

  async deriveRecoveryPassphrase(input: { wrappingKey: string }): Promise<PassportFileCryptoResult<string>> {
    const wrappingBytes = decodeWrappingKey(input.wrappingKey);
    if (!wrappingBytes.ok) {
      return wrappingBytes;
    }

    const wrappingMaterial = wrappingBytes.value;
    try {
      const passphraseBytes = await this.#deriveBits(
        wrappingMaterial,
        recoveryPassphraseDerivationSalt,
        recoveryPassphraseDerivationInfo,
        recoveryPassphraseBytes,
      );

      const passphrase = encodeBase64Url(passphraseBytes);
      passphraseBytes.fill(0);

      return { ok: true, value: passphrase };
    } catch {
      return failure("passphrase_derivation_failed");
    } finally {
      wrappingMaterial.fill(0);
    }
  }

  async #deriveAesGcmKey(wrappingBytes: Uint8Array): Promise<CryptoKey> {
    const hkdfKey = await this.#subtle.importKey("raw", toArrayBuffer(wrappingBytes), "HKDF", false, ["deriveKey"]);

    return this.#subtle.deriveKey(
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
  }

  async #deriveBits(wrappingBytes: Uint8Array, salt: Uint8Array, info: Uint8Array, byteLength: number): Promise<Uint8Array> {
    const hkdfKey = await this.#subtle.importKey("raw", toArrayBuffer(wrappingBytes), "HKDF", false, ["deriveBits"]);
    const bits = await this.#subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(salt), info: toArrayBuffer(info) },
      hkdfKey,
      byteLength * 8,
    );

    return new Uint8Array(bits);
  }
}

function isValidRecoveryFileBytes(recoveryFileBytes: Uint8Array): boolean {
  return recoveryFileBytes instanceof Uint8Array && recoveryFileBytes.byteLength > 0;
}

function decodeWrappingKey(value: string): PassportFileCryptoResult<Uint8Array> {
  const decoded = decodeBase64Url(value);
  if (!decoded.ok || decoded.value.byteLength !== wrappingKeyBytes) {
    return failure("invalid_wrapping_key");
  }

  return decoded;
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
