import { Result, type Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectAsyncResultError, expectResultError } from "../../../../test-utils/resultAssertions";
import { encodeBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_BYTES } from "../pubky/pubkyIdentityKey";
import { parsePassportFileEnvelope } from "./passportFileEnvelope";
import { PassportFileWebCrypto } from "./passportFileWebCrypto";

const SECRET_KEY_BYTES = new Uint8Array(Array.from({ length: PUBKY_SECRET_KEY_BYTES }, (_, index) => index + 11));

const WRAPPING_KEY = encodeBase64Url(new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)));
const DIFFERENT_WRAPPING_KEY = encodeBase64Url(new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index)));

afterEach(() => vi.restoreAllMocks());

function createCrypto(): PassportFileWebCrypto {
  return new PassportFileWebCrypto();
}

function encrypt(
  crypto: PassportFileWebCrypto,
  secretKeyBytes: Uint8Array,
  wrappingKey: string,
  passportOrigin: string,
) {
  return crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey, passportOrigin });
}

function decrypt(
  crypto: PassportFileWebCrypto,
  envelope: Parameters<PassportFileWebCrypto["decryptSecretKeyBytes"]>[0]["envelope"],
  wrappingKey: string,
  passportOrigin: string,
) {
  return crypto.decryptSecretKeyBytes({ envelope, wrappingKey, passportOrigin });
}

function tamperBase64Url(value: string): string {
  const replacement = value[0] === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

function expectError(result: ResultType<unknown, { code: string }>, code: string): void {
  expectResultError(result, { code });
}

async function expectAsyncError(result: Promise<ResultType<unknown, { code: string }>>, code: string): Promise<void> {
  await expectAsyncResultError(result, { code });
}

describe("PassportFileWebCrypto", () => {
  it("does not throw when browser crypto dependencies are unavailable", () => {
    expect(() => new PassportFileWebCrypto({ subtle: null, getRandomValues: null })).not.toThrow();
  });

  it("returns unsupported_browser_crypto when SubtleCrypto is unavailable", async () => {
    const crypto = new PassportFileWebCrypto({ subtle: null });

    await expectAsyncError(encrypt(crypto, SECRET_KEY_BYTES, "not+decoded", "https://passport.pubky.app"), "unsupported_browser_crypto");
  });

  it("returns unsupported_browser_crypto when getRandomValues is unavailable", async () => {
    const crypto = new PassportFileWebCrypto({ getRandomValues: null });

    await expectAsyncError(encrypt(crypto, SECRET_KEY_BYTES, "not+decoded", "https://passport.pubky.app"), "unsupported_browser_crypto");
  });

  it("returns unsupported_browser_crypto during decrypt when WebCrypto is unavailable", async () => {
    const crypto = new PassportFileWebCrypto({ subtle: null, getRandomValues: null });

    await expectAsyncError(decrypt(crypto,
      {
        v: 1,
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: encodeBase64Url(new Uint8Array([1])),
        url: "https://passport.pubky.app",
      },
      "not+decoded",
      "https://passport.pubky.app",
    ), "unsupported_browser_crypto");
  });

  it("maps unsupported HKDF import to unsupported_browser_crypto", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const subtle = {
      decrypt: globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle),
      deriveKey: globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle),
      encrypt: globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle),
      importKey: async (): Promise<CryptoKey> => {
        throw new Error("SECRET-HKDF-FAILURE");
      },
    } as unknown as SubtleCrypto;
    const crypto = new PassportFileWebCrypto({ subtle });

    await expectAsyncError(encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"), "unsupported_browser_crypto");
    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "derive_key",
      code: "unsupported_browser_crypto",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-HKDF-FAILURE");
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(encodeBase64Url(SECRET_KEY_BYTES));
  });

  it("logs encryption exceptions without retaining key material or exception details", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const subtle = {
      decrypt: globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle),
      deriveKey: globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle),
      encrypt: async (): Promise<ArrayBuffer> => { throw new Error("SECRET-ENCRYPT-FAILURE"); },
      importKey: globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle),
    } as unknown as SubtleCrypto;

    await expectAsyncError(encrypt(
      new PassportFileWebCrypto({ subtle }),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ), "encrypt_failed");

    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "encrypt",
      code: "encrypt_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-ENCRYPT-FAILURE");
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(encodeBase64Url(SECRET_KEY_BYTES));
  });

  it("maps unsupported AES-GCM derivation to unsupported_browser_crypto", async () => {
    const subtle = {
      decrypt: globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle),
      deriveKey: async (): Promise<CryptoKey> => {
        throw new Error("AES-GCM derivation unsupported");
      },
      encrypt: globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle),
      importKey: globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle),
    } as unknown as SubtleCrypto;
    const crypto = new PassportFileWebCrypto({ subtle });

    await expectAsyncError(encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"), "unsupported_browser_crypto");
  });

  it("encrypts a Pubky secret key into a v1 envelope", async () => {
    const result = await encrypt(createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app/",
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.v).toBe(1);
    expect(result.value.url).toBe("https://passport.pubky.app");
    expect(result.value.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.value.ct).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.value.ct).not.toBe(encodeBase64Url(SECRET_KEY_BYTES));
    expect(Result.isOk(parsePassportFileEnvelope(result.value))).toBe(true);
  });

  it("round-trips encrypted Pubky secret key bytes", async () => {
    const crypto = createCrypto();
    const encrypted = await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");

    expect(Result.isOk(encrypted)).toBe(true);
    if (Result.isError(encrypted)) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await decrypt(crypto, encrypted.value, WRAPPING_KEY, "https://passport.pubky.app");

    expect(Result.isOk(decrypted)).toBe(true);
    if (Result.isError(decrypted)) {
      throw new Error(decrypted.error.code);
    }

    expect(decrypted.value).toEqual(SECRET_KEY_BYTES);
  });

  it("uses a fresh IV for each encryption", async () => {
    const crypto = createCrypto();
    const first = await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");
    const second = await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");

    expect(Result.isOk(first)).toBe(true);
    expect(Result.isOk(second)).toBe(true);
    if (Result.isError(first) || Result.isError(second)) {
      throw new Error("encryption failed");
    }

    expect(first.value.iv).not.toBe(second.value.iv);
    expect(first.value.ct).not.toBe(second.value.ct);
  });

  it("fails safely with a different wrapping key", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const encrypted = await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");

    expect(Result.isOk(encrypted)).toBe(true);
    if (Result.isError(encrypted)) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await decrypt(createCrypto(), encrypted.value, DIFFERENT_WRAPPING_KEY, "https://passport.pubky.app");

    expectError(decrypted, "decrypt_failed");
    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "decrypt",
      code: "decrypt_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(DIFFERENT_WRAPPING_KEY);
    expect(logged).not.toContain(encrypted.value.iv);
    expect(logged).not.toContain(encrypted.value.ct);
  });

  it("logs decryption exceptions without retaining envelope or exception details", async () => {
    const encrypted = await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");
    if (Result.isError(encrypted)) throw new Error(encrypted.error.code);
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const subtle = {
      decrypt: async (): Promise<ArrayBuffer> => { throw new Error("SECRET-DECRYPT-FAILURE"); },
      deriveKey: globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle),
      encrypt: globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle),
      importKey: globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle),
    } as unknown as SubtleCrypto;

    await expectAsyncError(decrypt(
      new PassportFileWebCrypto({ subtle }),
      encrypted.value,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ), "decrypt_failed");

    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "decrypt",
      code: "decrypt_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-DECRYPT-FAILURE");
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(encrypted.value.iv);
    expect(logged).not.toContain(encrypted.value.ct);
  });

  it("fails safely when ciphertext is tampered", async () => {
    const encrypted = await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");

    expect(Result.isOk(encrypted)).toBe(true);
    if (Result.isError(encrypted)) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await decrypt(createCrypto(),
      { ...encrypted.value, ct: tamperBase64Url(encrypted.value.ct) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectError(decrypted, "decrypt_failed");
  });

  it("fails safely when IV is tampered", async () => {
    const encrypted = await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");

    expect(Result.isOk(encrypted)).toBe(true);
    if (Result.isError(encrypted)) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await decrypt(createCrypto(),
      { ...encrypted.value, iv: encodeBase64Url(new Uint8Array(11)) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectError(decrypted, "invalid_envelope");
  });

  it("rejects ciphertext that is not the v1 secret key and GCM tag size", async () => {
    const decrypted = await decrypt(createCrypto(),
      {
        v: 1,
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: encodeBase64Url(new Uint8Array(PUBKY_SECRET_KEY_BYTES + 17)),
        url: "https://passport.pubky.app",
      },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectError(decrypted, "invalid_envelope");
  });

  it("clears rejected decrypted plaintext", async () => {
    const rejectedPlaintext = new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1).fill(7);
    const subtle = {
      decrypt: async (): Promise<ArrayBuffer> => rejectedPlaintext.buffer,
      deriveKey: globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle),
      encrypt: globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle),
      importKey: globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle),
    } as unknown as SubtleCrypto;
    const crypto = new PassportFileWebCrypto({ subtle });

    await expectAsyncError(decrypt(crypto,
      {
        v: 1,
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: encodeBase64Url(new Uint8Array(PUBKY_SECRET_KEY_BYTES + 16)),
        url: "https://passport.pubky.app",
      },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ), "invalid_plaintext");

    expect(rejectedPlaintext).toEqual(new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1));
  });

  it("rejects overlong base64url ciphertext before decoding it", async () => {
    const decrypted = await decrypt(createCrypto(),
      {
        v: 1,
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: "A".repeat(1024 * 1024),
        url: "https://passport.pubky.app",
      },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectError(decrypted, "invalid_envelope");
  });

  it("fails safely when authenticated envelope metadata is tampered", async () => {
    const encrypted = await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app");

    expect(Result.isOk(encrypted)).toBe(true);
    if (Result.isError(encrypted)) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await decrypt(createCrypto(),
      { ...encrypted.value, url: "https://passport-staging.pubky.app" },
      WRAPPING_KEY,
      "https://passport-staging.pubky.app",
    );

    expectError(decrypted, "decrypt_failed");
  });

  it("rejects an envelope created for a different Passport origin", async () => {
    const encrypted = await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport-staging.pubky.app");

    expect(Result.isOk(encrypted)).toBe(true);
    if (Result.isError(encrypted)) {
      throw new Error(encrypted.error.code);
    }

    await expectAsyncError(
      decrypt(createCrypto(), encrypted.value, WRAPPING_KEY, "https://passport.pubky.app"),
      "invalid_envelope",
    );
  });

  it("rejects invalid wrapping keys", async () => {
    const crypto = createCrypto();

    await expectAsyncError(encrypt(crypto, SECRET_KEY_BYTES, "not+base64url", "https://passport.pubky.app"), "invalid_wrapping_key");

    await expectAsyncError(encrypt(crypto,
      SECRET_KEY_BYTES,
      encodeBase64Url(new Uint8Array(31)),
      "https://passport.pubky.app",
    ), "invalid_wrapping_key");
  });

  it("rejects invalid plaintext and envelope inputs", async () => {
    const crypto = createCrypto();

    await expectAsyncError(encrypt(crypto,
      new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1),
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ), "invalid_plaintext");

    await expectAsyncError(encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app/path"), "invalid_envelope");
  });
});
