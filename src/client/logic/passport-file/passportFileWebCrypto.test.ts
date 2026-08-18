import { afterEach, describe, expect, it, vi } from "vitest";

import {
  expectAsyncResultError,
  expectResultError,
  expectResultOk,
} from "../../../../test-utils/resultAssertions";
import { encodeBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_BYTES } from "../pubky/pubkyIdentityKey";
import { parsePassportFileEnvelope } from "./passportFileEnvelope";
import { PassportFileWebCrypto } from "./PassportFileWebCrypto";

const SECRET_KEY_BYTES = new Uint8Array(Array.from({ length: PUBKY_SECRET_KEY_BYTES }, (_, index) => index + 11));

const WRAPPING_KEY = encodeBase64Url(new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)));
const DIFFERENT_WRAPPING_KEY = encodeBase64Url(new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index)));
const COMPATIBILITY_IV = new Uint8Array(Array.from({ length: 12 }, (_, index) => index));
const COMPATIBILITY_ENVELOPE = {
  v: 1 as const,
  iv: "AAECAwQFBgcICQoL",
  ct: "YZy1I_a6WzFnql8rW2A94EJrgz38Sqd1LV_KjVe2Qd2n1mvFMXg9qzRHwJ_WQvrm",
  url: "https://passport.pubky.app",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createCrypto(): PassportFileWebCrypto {
  return new PassportFileWebCrypto();
}

function nativeDecrypt(...args: Parameters<SubtleCrypto["decrypt"]>): ReturnType<SubtleCrypto["decrypt"]> {
  return globalThis.crypto.subtle.decrypt(...args);
}

function nativeDeriveKey(...args: Parameters<SubtleCrypto["deriveKey"]>): ReturnType<SubtleCrypto["deriveKey"]> {
  return globalThis.crypto.subtle.deriveKey(...args);
}

function nativeEncrypt(...args: Parameters<SubtleCrypto["encrypt"]>): ReturnType<SubtleCrypto["encrypt"]> {
  return globalThis.crypto.subtle.encrypt(...args);
}

function nativeImportKey(...args: Parameters<SubtleCrypto["importKey"]>): ReturnType<SubtleCrypto["importKey"]> {
  return globalThis.crypto.subtle.importKey(...args);
}

function encrypt(
  crypto: PassportFileWebCrypto,
  secretKeyBytes: Uint8Array,
  wrappingKey: string,
  passportOrigin: string,
) {
  return crypto.encryptSecretKeyBytes(secretKeyBytes, wrappingKey, passportOrigin);
}

function decrypt(
  crypto: PassportFileWebCrypto,
  envelope: Parameters<PassportFileWebCrypto["decryptSecretKeyBytes"]>[0],
  wrappingKey: string,
  passportOrigin: string,
) {
  return crypto.decryptSecretKeyBytes(envelope, wrappingKey, passportOrigin);
}

function tamperBase64Url(value: string): string {
  const replacement = value[0] === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

describe("PassportFileWebCrypto", () => {
  it("does not throw when browser crypto dependencies are unavailable", () => {
    expect(() => new PassportFileWebCrypto(null)).not.toThrow();
  });

  it("returns unsupported_browser_crypto when SubtleCrypto is unavailable", async () => {
    const crypto = new PassportFileWebCrypto(null);

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, "not+decoded", "https://passport.pubky.app"),
      { code: "unsupported_browser_crypto" },
    );
  });

  it("returns unsupported_browser_crypto when getRandomValues is unavailable", async () => {
    const subtle = globalThis.crypto.subtle;
    vi.stubGlobal("crypto", { subtle });
    const crypto = new PassportFileWebCrypto(subtle);

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, "not+decoded", "https://passport.pubky.app"),
      { code: "unsupported_browser_crypto" },
    );
  });

  it("decrypts when getRandomValues is unavailable", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));

    const subtle = globalThis.crypto.subtle;
    vi.stubGlobal("crypto", { subtle });
    const secretKey = expectResultOk(await decrypt(
      new PassportFileWebCrypto(subtle),
      envelope,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));

    expect(secretKey).toEqual(SECRET_KEY_BYTES);
  });

  it("returns unsupported_browser_crypto during decrypt when WebCrypto is unavailable", async () => {
    const crypto = new PassportFileWebCrypto(null);

    await expectAsyncResultError(
      decrypt(
        crypto,
        COMPATIBILITY_ENVELOPE,
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      { code: "unsupported_browser_crypto" },
    );
  });

  it("maps unsupported HKDF import to unsupported_browser_crypto", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const subtle = {
      decrypt: nativeDecrypt,
      deriveKey: nativeDeriveKey,
      encrypt: nativeEncrypt,
      importKey: async (): Promise<CryptoKey> => {
        throw new Error("SECRET-HKDF-FAILURE");
      },
    } as unknown as SubtleCrypto;
    const crypto = new PassportFileWebCrypto(subtle);

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
      { code: "unsupported_browser_crypto" },
    );
    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "encrypt",
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
      decrypt: nativeDecrypt,
      deriveKey: nativeDeriveKey,
      encrypt: async (): Promise<ArrayBuffer> => { throw new Error("SECRET-ENCRYPT-FAILURE"); },
      importKey: nativeImportKey,
    } as unknown as SubtleCrypto;

    await expectAsyncResultError(
      encrypt(
        new PassportFileWebCrypto(subtle),
        SECRET_KEY_BYTES,
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      { code: "encrypt_failed" },
    );

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
      decrypt: nativeDecrypt,
      deriveKey: async (): Promise<CryptoKey> => {
        throw new Error("AES-GCM derivation unsupported");
      },
      encrypt: nativeEncrypt,
      importKey: nativeImportKey,
    } as unknown as SubtleCrypto;
    const crypto = new PassportFileWebCrypto(subtle);

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
      { code: "unsupported_browser_crypto" },
    );
  });

  it("encrypts a Pubky secret key into a v1 envelope", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app/",
    ));

    expect(envelope.v).toBe(1);
    expect(envelope.url).toBe("https://passport.pubky.app");
    expect(envelope.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.ct).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.ct).not.toBe(encodeBase64Url(SECRET_KEY_BYTES));
    expectResultOk(parsePassportFileEnvelope(envelope));
  });

  it("matches the frozen v1 compatibility vector", async () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      if (array instanceof Uint8Array) array.set(COMPATIBILITY_IV);
      return array;
    });
    const crypto = new PassportFileWebCrypto();

    const envelope = expectResultOk(await encrypt(
      crypto,
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      COMPATIBILITY_ENVELOPE.url,
    ));
    expect(envelope).toEqual(COMPATIBILITY_ENVELOPE);

    const secretKey = expectResultOk(await decrypt(
      createCrypto(),
      COMPATIBILITY_ENVELOPE,
      WRAPPING_KEY,
      COMPATIBILITY_ENVELOPE.url,
    ));
    expect(secretKey).toEqual(SECRET_KEY_BYTES);
  });

  it("round-trips encrypted Pubky secret key bytes", async () => {
    const crypto = createCrypto();
    const envelope = expectResultOk(await encrypt(
      crypto,
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));
    const secretKey = expectResultOk(await decrypt(
      crypto,
      envelope,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));

    expect(secretKey).toEqual(SECRET_KEY_BYTES);
  });

  it("encrypts a snapshot when the caller mutates its secret during key derivation", async () => {
    let continueDerivation = (): void => undefined;
    let markDerivationStarted = (): void => undefined;
    const derivationStarted = new Promise<void>((resolve) => { markDerivationStarted = resolve; });
    const derivationMayContinue = new Promise<void>((resolve) => { continueDerivation = resolve; });
    const subtle = {
      decrypt: nativeDecrypt,
      deriveKey: async (...args: Parameters<SubtleCrypto["deriveKey"]>): ReturnType<SubtleCrypto["deriveKey"]> => {
        markDerivationStarted();
        await derivationMayContinue;
        return nativeDeriveKey(...args);
      },
      encrypt: nativeEncrypt,
      importKey: nativeImportKey,
    } as unknown as SubtleCrypto;
    const mutableSecret = Uint8Array.from(SECRET_KEY_BYTES);

    const pendingEncryption = encrypt(
      new PassportFileWebCrypto(subtle),
      mutableSecret,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );
    await derivationStarted;
    mutableSecret.fill(0);
    continueDerivation();

    const envelope = expectResultOk(await pendingEncryption);
    const secretKey = expectResultOk(await decrypt(
      createCrypto(),
      envelope,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));
    expect(secretKey).toEqual(SECRET_KEY_BYTES);
  });

  it("uses a fresh IV for each encryption", async () => {
    const crypto = createCrypto();
    const first = expectResultOk(await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"));
    const second = expectResultOk(await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"));

    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
  });

  it("fails safely with a different wrapping key", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));
    const decrypted = await decrypt(
      createCrypto(),
      envelope,
      DIFFERENT_WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectResultError(decrypted, { code: "decrypt_failed" });
    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "decrypt",
      code: "decrypt_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(DIFFERENT_WRAPPING_KEY);
    expect(logged).not.toContain(envelope.iv);
    expect(logged).not.toContain(envelope.ct);
  });

  it("logs decryption exceptions without retaining envelope or exception details", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const subtle = {
      decrypt: async (): Promise<ArrayBuffer> => { throw new Error("SECRET-DECRYPT-FAILURE"); },
      deriveKey: nativeDeriveKey,
      encrypt: nativeEncrypt,
      importKey: nativeImportKey,
    } as unknown as SubtleCrypto;

    await expectAsyncResultError(
      decrypt(
        new PassportFileWebCrypto(subtle),
        envelope,
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      { code: "decrypt_failed" },
    );

    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "decrypt",
      code: "decrypt_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-DECRYPT-FAILURE");
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(envelope.iv);
    expect(logged).not.toContain(envelope.ct);
  });

  it("fails safely when ciphertext is tampered", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));

    const decrypted = await decrypt(createCrypto(),
      { ...envelope, ct: tamperBase64Url(envelope.ct) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectResultError(decrypted, { code: "decrypt_failed" });
  });

  it("rejects an incorrectly sized IV before decryption", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));

    const decrypted = await decrypt(createCrypto(),
      { ...envelope, iv: encodeBase64Url(new Uint8Array(11)) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectResultError(decrypted, { code: "invalid_envelope" });
  });

  it("fails authentication when a valid-length IV is tampered", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));

    const decrypted = await decrypt(
      createCrypto(),
      { ...envelope, iv: tamperBase64Url(envelope.iv) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectResultError(decrypted, { code: "decrypt_failed" });
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

    expectResultError(decrypted, { code: "invalid_envelope" });
  });

  it("clears rejected decrypted plaintext", async () => {
    const rejectedPlaintext = new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1).fill(7);
    const subtle = {
      decrypt: async (): Promise<ArrayBuffer> => rejectedPlaintext.buffer,
      deriveKey: nativeDeriveKey,
      encrypt: nativeEncrypt,
      importKey: nativeImportKey,
    } as unknown as SubtleCrypto;
    const crypto = new PassportFileWebCrypto(subtle);

    await expectAsyncResultError(
      decrypt(
        crypto,
        {
          v: 1,
          iv: encodeBase64Url(new Uint8Array(12)),
          ct: encodeBase64Url(new Uint8Array(PUBKY_SECRET_KEY_BYTES + 16)),
          url: "https://passport.pubky.app",
        },
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      { code: "invalid_plaintext" },
    );

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

    expectResultError(decrypted, { code: "invalid_envelope" });
  });

  it("fails safely when authenticated envelope metadata is tampered", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    ));

    const decrypted = await decrypt(createCrypto(),
      { ...envelope, url: "https://passport-staging.pubky.app" },
      WRAPPING_KEY,
      "https://passport-staging.pubky.app",
    );

    expectResultError(decrypted, { code: "decrypt_failed" });
  });

  it("rejects an envelope created for a different Passport origin", async () => {
    const envelope = expectResultOk(await encrypt(
      createCrypto(),
      SECRET_KEY_BYTES,
      WRAPPING_KEY,
      "https://passport-staging.pubky.app",
    ));

    await expectAsyncResultError(
      decrypt(createCrypto(), envelope, WRAPPING_KEY, "https://passport.pubky.app"),
      { code: "invalid_envelope" },
    );
  });

  it("rejects invalid wrapping keys", async () => {
    const crypto = createCrypto();

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, "not+base64url", "https://passport.pubky.app"),
      { code: "invalid_wrapping_key" },
    );

    await expectAsyncResultError(
      encrypt(
        crypto,
        SECRET_KEY_BYTES,
        encodeBase64Url(new Uint8Array(31)),
        "https://passport.pubky.app",
      ),
      { code: "invalid_wrapping_key" },
    );

    await expectAsyncResultError(
      encrypt(
        crypto,
        SECRET_KEY_BYTES,
        "A".repeat(1024 * 1024),
        "https://passport.pubky.app",
      ),
      { code: "invalid_wrapping_key" },
    );
  });

  it("rejects invalid plaintext and envelope inputs", async () => {
    const crypto = createCrypto();

    await expectAsyncResultError(
      encrypt(
        crypto,
        new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1),
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      { code: "invalid_plaintext" },
    );

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app/path"),
      { code: "invalid_envelope" },
    );
  });
});
