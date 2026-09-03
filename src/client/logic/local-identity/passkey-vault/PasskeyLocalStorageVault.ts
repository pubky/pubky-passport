import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  decodeBase64Url,
  encodeBase64Url,
  isCanonicalBase64Url,
} from "../../../../libs/encoding/base64Url";
import type { CodedFailure } from "../../../../libs/result";
import {
  isPubkyPublicKey,
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "../../pubky/pubkyIdentityKey";
import {
  PASSKEY_PRF_INPUT_BYTES,
  type PasskeyPrfErrorCode,
  type PasskeyPrfKeySource,
} from "./BrowserPasskeyPrfKeySource";

export const VIBES_PASSKEY_VAULT_STORAGE_ROOT = "pubky-passport/vibes-localstorage-encryption/v1";

const CONFIGURATION_KEY = `${VIBES_PASSKEY_VAULT_STORAGE_ROOT}/configuration`;
const IDENTITY_KEY_PREFIX = `${VIBES_PASSKEY_VAULT_STORAGE_ROOT}/identity/`;
const VAULT_ALGORITHM = "WebAuthn-PRF+HKDF-SHA-256+A256GCM";
const SECRET_ALGORITHM = "A256GCM";
const DATA_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const WRAPPED_DATA_KEY_BYTES = DATA_KEY_BYTES + AES_GCM_TAG_BITS / 8;
const ENCRYPTED_SECRET_KEY_BYTES = PUBKY_SECRET_KEY_BYTES + AES_GCM_TAG_BITS / 8;
const MAXIMUM_CONFIGURATION_CHARACTERS = 4096;
const MAXIMUM_IDENTITY_RECORD_CHARACTERS = 1024;
const MAXIMUM_CREDENTIAL_ID_BYTES = 1023;
const TEXT_ENCODER = new TextEncoder();
const HKDF_SALT = TEXT_ENCODER.encode("pubky-passport/vibes-localstorage-encryption/hkdf/salt/v1");

type StoredVaultConfiguration = {
  v: 1;
  alg: typeof VAULT_ALGORITHM;
  origin: string;
  credentialId: string;
  prfSalt: string;
  wrappedDataKey: {
    iv: string;
    ct: string;
  };
};

type StoredEncryptedSecret = {
  v: 1;
  alg: typeof SECRET_ALGORITHM;
  publicKeyZ32: string;
  iv: string;
  ct: string;
};

export type PasskeyLocalStorageVaultErrorCode =
  | PasskeyPrfErrorCode
  | "already_enrolled"
  | "crypto_failed"
  | "identity_unavailable"
  | "invalid_identity"
  | "invalid_origin"
  | "invalid_secret_key"
  | "invalid_store"
  | "locked"
  | "not_enrolled"
  | "storage_unavailable"
  | "unlock_failed";

export type PasskeyLocalStorageVaultResult<Success> = ResultType<
  Success,
  CodedFailure<PasskeyLocalStorageVaultErrorCode>
>;

/**
 * Proof-of-concept envelope encryption for Pubky secret keys in localStorage.
 *
 * A WebAuthn PRF output derives a wrapping key; a random data key encrypts all
 * identity secrets and exists only as a non-extractable CryptoKey while unlocked.
 * Metadata remains readable while locked. `lock()` releases the handle but cannot
 * promise memory zeroization in JavaScript. Secret bytes returned by `readSecret`
 * are caller-owned and must be released promptly.
 */
export class PasskeyLocalStorageVault {
  private dataKey: CryptoKey | null = null;
  private lockEpoch = 0;

  constructor(
    private readonly storage: Storage,
    private readonly browserCrypto: Crypto,
    private readonly keySource: PasskeyPrfKeySource,
    private readonly origin: string,
  ) {}

  get isUnlocked(): boolean {
    return this.dataKey !== null;
  }

  /**
   * Creates a user-verifying PRF credential and stores only its public locator,
   * salt, and an authenticated encryption of a new data key. A failed setup may
   * leave an orphaned passkey in the user's credential provider.
   */
  async enroll(): Promise<PasskeyLocalStorageVaultResult<void>> {
    const expectedLockEpoch = this.lockEpoch;
    const canonicalOrigin = normalizeOrigin(this.origin);
    if (!canonicalOrigin) return Result.err({ code: "invalid_origin" });

    const existing = this.readConfiguration(canonicalOrigin);
    if (Result.isError(existing)) return Result.err(existing.error);
    if (existing.value) return Result.err({ code: "already_enrolled" });

    const prfSalt = this.randomBytes(PASSKEY_PRF_INPUT_BYTES);
    const enrollment = await this.keySource.createCredential(prfSalt);
    if (Result.isError(enrollment)) return Result.err(enrollment.error);
    if (
      !isCredentialId(enrollment.value.credentialId) ||
      !isPrfOutput(enrollment.value.prfOutput)
    ) {
      enrollment.value.prfOutput.fill(0);
      return Result.err({ code: "invalid_credential" });
    }

    const dataKeyBytes = this.randomBytes(DATA_KEY_BYTES);
    const wrapIv = this.randomBytes(AES_GCM_IV_BYTES);
    try {
      const wrappingKey = await deriveWrappingKey(
        this.browserCrypto.subtle,
        enrollment.value.prfOutput,
        canonicalOrigin,
        enrollment.value.credentialId,
      );
      const prfSaltEncoded = encodeBase64Url(prfSalt);
      const wrappedDataKey = await this.browserCrypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: copyToArrayBuffer(wrapIv),
          additionalData: configurationAdditionalData(
            canonicalOrigin,
            enrollment.value.credentialId,
            prfSaltEncoded,
          ),
          tagLength: AES_GCM_TAG_BITS,
        },
        wrappingKey,
        copyToArrayBuffer(dataKeyBytes),
      );
      const importedDataKey = await importDataKey(this.browserCrypto.subtle, dataKeyBytes);
      const configuration: StoredVaultConfiguration = {
        v: 1,
        alg: VAULT_ALGORITHM,
        origin: canonicalOrigin,
        credentialId: enrollment.value.credentialId,
        prfSalt: prfSaltEncoded,
        wrappedDataKey: {
          iv: encodeBase64Url(wrapIv),
          ct: encodeBase64Url(new Uint8Array(wrappedDataKey)),
        },
      };

      if (this.lockEpoch !== expectedLockEpoch) return Result.err({ code: "locked" });
      try {
        this.storage.setItem(CONFIGURATION_KEY, JSON.stringify(configuration));
      } catch (cause) {
        return Result.err({ code: "storage_unavailable", cause });
      }
      this.dataKey = importedDataKey;
      return Result.ok();
    } catch (cause) {
      return Result.err({ code: "crypto_failed", cause });
    } finally {
      dataKeyBytes.fill(0);
      enrollment.value.prfOutput.fill(0);
    }
  }

  /** Requires a fresh user-verifying WebAuthn ceremony unless already unlocked. */
  async unlock(): Promise<PasskeyLocalStorageVaultResult<void>> {
    if (this.dataKey) return Result.ok();
    const expectedLockEpoch = this.lockEpoch;
    const canonicalOrigin = normalizeOrigin(this.origin);
    if (!canonicalOrigin) return Result.err({ code: "invalid_origin" });

    const configuration = this.readConfiguration(canonicalOrigin);
    if (Result.isError(configuration)) return Result.err(configuration.error);
    if (!configuration.value) return Result.err({ code: "not_enrolled" });

    const prfSalt = decodeFixedLengthBase64Url(
      configuration.value.prfSalt,
      PASSKEY_PRF_INPUT_BYTES,
    );
    if (!prfSalt) return Result.err({ code: "invalid_store" });

    const evaluated = await this.keySource.evaluate(configuration.value.credentialId, prfSalt);
    if (Result.isError(evaluated)) return Result.err(evaluated.error);
    if (evaluated.value.byteLength !== PASSKEY_PRF_INPUT_BYTES) {
      evaluated.value.fill(0);
      return Result.err({ code: "invalid_credential" });
    }

    const wrapIv = decodeFixedLengthBase64Url(
      configuration.value.wrappedDataKey.iv,
      AES_GCM_IV_BYTES,
    );
    const wrappedDataKey = decodeFixedLengthBase64Url(
      configuration.value.wrappedDataKey.ct,
      WRAPPED_DATA_KEY_BYTES,
    );
    if (!wrapIv || !wrappedDataKey) return Result.err({ code: "invalid_store" });

    try {
      const wrappingKey = await deriveWrappingKey(
        this.browserCrypto.subtle,
        evaluated.value,
        canonicalOrigin,
        configuration.value.credentialId,
      );
      const plaintext = await this.browserCrypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: copyToArrayBuffer(wrapIv),
          additionalData: configurationAdditionalData(
            canonicalOrigin,
            configuration.value.credentialId,
            configuration.value.prfSalt,
          ),
          tagLength: AES_GCM_TAG_BITS,
        },
        wrappingKey,
        copyToArrayBuffer(wrappedDataKey),
      );
      const dataKeyBytes = new Uint8Array(plaintext);
      if (dataKeyBytes.byteLength !== DATA_KEY_BYTES) {
        dataKeyBytes.fill(0);
        return Result.err({ code: "unlock_failed" });
      }
      try {
        const importedDataKey = await importDataKey(this.browserCrypto.subtle, dataKeyBytes);
        if (this.lockEpoch !== expectedLockEpoch) return Result.err({ code: "locked" });
        this.dataKey = importedDataKey;
      } finally {
        dataKeyBytes.fill(0);
      }
      return Result.ok();
    } catch (cause) {
      return Result.err({ code: "unlock_failed", cause });
    } finally {
      evaluated.value.fill(0);
    }
  }

  lock(): void {
    this.dataKey = null;
    this.lockEpoch += 1;
  }

  async saveSecret(
    publicKeyZ32: string,
    secretKey: PubkySecretKeyMaterial,
  ): Promise<PasskeyLocalStorageVaultResult<void>> {
    const dataKey = this.dataKey;
    const expectedLockEpoch = this.lockEpoch;
    if (!dataKey) return Result.err({ code: "locked" });
    if (!isPubkyPublicKey(publicKeyZ32)) return Result.err({ code: "invalid_identity" });
    if (
      secretKey.format !== PUBKY_SECRET_KEY_FORMAT ||
      !(secretKey.bytes instanceof Uint8Array) ||
      secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES
    ) {
      return Result.err({ code: "invalid_secret_key" });
    }

    const canonicalOrigin = normalizeOrigin(this.origin);
    if (!canonicalOrigin) return Result.err({ code: "invalid_origin" });
    const iv = this.randomBytes(AES_GCM_IV_BYTES);
    const plaintext = Uint8Array.from(secretKey.bytes);
    let ciphertext: ArrayBuffer;
    try {
      ciphertext = await this.browserCrypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: copyToArrayBuffer(iv),
          additionalData: secretAdditionalData(canonicalOrigin, publicKeyZ32),
          tagLength: AES_GCM_TAG_BITS,
        },
        dataKey,
        copyToArrayBuffer(plaintext),
      );
    } catch (cause) {
      return Result.err({ code: "crypto_failed", cause });
    } finally {
      plaintext.fill(0);
    }

    const stored: StoredEncryptedSecret = {
      v: 1,
      alg: SECRET_ALGORITHM,
      publicKeyZ32,
      iv: encodeBase64Url(iv),
      ct: encodeBase64Url(new Uint8Array(ciphertext)),
    };
    if (this.lockEpoch !== expectedLockEpoch) return Result.err({ code: "locked" });
    try {
      this.storage.setItem(identityStorageKey(publicKeyZ32), JSON.stringify(stored));
      return Result.ok();
    } catch (cause) {
      return Result.err({ code: "storage_unavailable", cause });
    }
  }

  async readSecret(
    publicKeyZ32: string,
  ): Promise<PasskeyLocalStorageVaultResult<PubkySecretKeyMaterial>> {
    const dataKey = this.dataKey;
    const expectedLockEpoch = this.lockEpoch;
    if (!dataKey) return Result.err({ code: "locked" });
    if (!isPubkyPublicKey(publicKeyZ32)) return Result.err({ code: "invalid_identity" });
    const canonicalOrigin = normalizeOrigin(this.origin);
    if (!canonicalOrigin) return Result.err({ code: "invalid_origin" });

    let serialized: string | null;
    try {
      serialized = this.storage.getItem(identityStorageKey(publicKeyZ32));
    } catch (cause) {
      return Result.err({ code: "storage_unavailable", cause });
    }
    if (serialized === null) return Result.err({ code: "identity_unavailable" });

    const stored = parseStoredSecret(serialized, publicKeyZ32);
    if (!stored) return Result.err({ code: "invalid_store" });
    const iv = decodeFixedLengthBase64Url(stored.iv, AES_GCM_IV_BYTES);
    const ciphertext = decodeFixedLengthBase64Url(stored.ct, ENCRYPTED_SECRET_KEY_BYTES);
    if (!iv || !ciphertext) return Result.err({ code: "invalid_store" });

    try {
      const plaintext = await this.browserCrypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: copyToArrayBuffer(iv),
          additionalData: secretAdditionalData(canonicalOrigin, publicKeyZ32),
          tagLength: AES_GCM_TAG_BITS,
        },
        dataKey,
        copyToArrayBuffer(ciphertext),
      );
      const secretKeyBytes = new Uint8Array(plaintext);
      if (this.lockEpoch !== expectedLockEpoch) {
        secretKeyBytes.fill(0);
        return Result.err({ code: "locked" });
      }
      if (secretKeyBytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
        secretKeyBytes.fill(0);
        return Result.err({ code: "invalid_secret_key" });
      }
      return Result.ok({ bytes: secretKeyBytes, format: PUBKY_SECRET_KEY_FORMAT });
    } catch (cause) {
      return Result.err({ code: "crypto_failed", cause });
    }
  }

  private readConfiguration(
    canonicalOrigin: string,
  ): PasskeyLocalStorageVaultResult<StoredVaultConfiguration | null> {
    try {
      const serialized = this.storage.getItem(CONFIGURATION_KEY);
      if (serialized === null) return Result.ok(null);
      const configuration = parseConfiguration(serialized, canonicalOrigin);
      return configuration ? Result.ok(configuration) : Result.err({ code: "invalid_store" });
    } catch (cause) {
      return Result.err({ code: "storage_unavailable", cause });
    }
  }

  private randomBytes(byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength);
    this.browserCrypto.getRandomValues(bytes);
    return bytes;
  }
}

async function deriveWrappingKey(
  subtle: SubtleCrypto,
  prfOutput: Uint8Array,
  origin: string,
  credentialId: string,
): Promise<CryptoKey> {
  const material = copyToArrayBuffer(prfOutput);
  try {
    const hkdfKey = await subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
    return await subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: copyToArrayBuffer(HKDF_SALT),
        info: copyToArrayBuffer(
          TEXT_ENCODER.encode(
            `pubky-passport/vibes-localstorage-encryption/wrapping-key/v1\n${origin}\n${credentialId}`,
          ),
        ),
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    clearArrayBuffer(material);
  }
}

async function importDataKey(subtle: SubtleCrypto, dataKeyBytes: Uint8Array): Promise<CryptoKey> {
  const material = copyToArrayBuffer(dataKeyBytes);
  try {
    return await subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  } finally {
    clearArrayBuffer(material);
  }
}

function parseConfiguration(
  serialized: string,
  expectedOrigin: string,
): StoredVaultConfiguration | null {
  if (serialized.length > MAXIMUM_CONFIGURATION_CHARACTERS) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["v", "alg", "origin", "credentialId", "prfSalt", "wrappedDataKey"]) ||
      value.v !== 1 ||
      value.alg !== VAULT_ALGORITHM ||
      value.origin !== expectedOrigin ||
      !isCredentialId(value.credentialId) ||
      !isFixedLengthBase64Url(value.prfSalt, PASSKEY_PRF_INPUT_BYTES) ||
      !isRecord(value.wrappedDataKey) ||
      !hasExactKeys(value.wrappedDataKey, ["iv", "ct"]) ||
      !isFixedLengthBase64Url(value.wrappedDataKey.iv, AES_GCM_IV_BYTES) ||
      !isFixedLengthBase64Url(value.wrappedDataKey.ct, WRAPPED_DATA_KEY_BYTES)
    ) {
      return null;
    }
    return value as StoredVaultConfiguration;
  } catch {
    return null;
  }
}

function parseStoredSecret(
  serialized: string,
  expectedPublicKeyZ32: string,
): StoredEncryptedSecret | null {
  if (serialized.length > MAXIMUM_IDENTITY_RECORD_CHARACTERS) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["v", "alg", "publicKeyZ32", "iv", "ct"]) ||
      value.v !== 1 ||
      value.alg !== SECRET_ALGORITHM ||
      value.publicKeyZ32 !== expectedPublicKeyZ32 ||
      !isFixedLengthBase64Url(value.iv, AES_GCM_IV_BYTES) ||
      !isFixedLengthBase64Url(value.ct, ENCRYPTED_SECRET_KEY_BYTES)
    ) {
      return null;
    }
    return value as StoredEncryptedSecret;
  } catch {
    return null;
  }
}

function configurationAdditionalData(
  origin: string,
  credentialId: string,
  prfSalt: string,
): ArrayBuffer {
  return copyToArrayBuffer(
    TEXT_ENCODER.encode(
      `pubky-passport/vibes-localstorage-encryption/configuration/v1\n${origin}\n${credentialId}\n${prfSalt}`,
    ),
  );
}

function secretAdditionalData(origin: string, publicKeyZ32: string): ArrayBuffer {
  return copyToArrayBuffer(
    TEXT_ENCODER.encode(
      `pubky-passport/vibes-localstorage-encryption/secret/v1\n${origin}\n${publicKeyZ32}`,
    ),
  );
}

function identityStorageKey(publicKeyZ32: string): string {
  return `${IDENTITY_KEY_PREFIX}${publicKeyZ32}`;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || url.hostname === "localhost")
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function isCredentialId(value: unknown): value is string {
  if (typeof value !== "string" || !isCanonicalBase64Url(value)) return false;
  const bytes = decodeBase64Url(value);
  return (
    bytes !== undefined && bytes.byteLength > 0 && bytes.byteLength <= MAXIMUM_CREDENTIAL_ID_BYTES
  );
}

function isPrfOutput(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === PASSKEY_PRF_INPUT_BYTES;
}

function isFixedLengthBase64Url(value: unknown, expectedByteLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length === base64UrlLength(expectedByteLength) &&
    decodeBase64Url(value)?.byteLength === expectedByteLength
  );
}

function decodeFixedLengthBase64Url(value: string, expectedByteLength: number): Uint8Array | null {
  return isFixedLengthBase64Url(value, expectedByteLength)
    ? (decodeBase64Url(value) ?? null)
    : null;
}

function base64UrlLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function clearArrayBuffer(buffer: ArrayBuffer): void {
  new Uint8Array(buffer).fill(0);
}
