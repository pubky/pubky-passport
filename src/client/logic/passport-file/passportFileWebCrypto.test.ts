import { Result, type Result as ResultType } from "better-result";
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

const SECRET_KEY_BYTES = new Uint8Array(
  Array.from({ length: PUBKY_SECRET_KEY_BYTES }, (_, index) => index + 11),
);

const WRAPPING_KEY = encodeBase64Url(
  new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
);
const DIFFERENT_WRAPPING_KEY = encodeBase64Url(
  new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index)),
);
const TEST_ENVELOPE = {
  v: 1 as const,
  keyId: "current",
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

function encrypt(
  crypto: PassportFileWebCrypto,
  secretKeyBytes: Uint8Array,
  wrappingKey: string,
  passportOrigin: string,
) {
  return crypto.encryptSecretKeyBytes(secretKeyBytes, wrappingKey, passportOrigin, "current");
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
  it("returns unsupported_browser_crypto when SubtleCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    const crypto = new PassportFileWebCrypto();

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, "not+decoded", "https://passport.pubky.app"),
      { code: "unsupported_browser_crypto" },
    );
  });

  it("returns unsupported_browser_crypto when getRandomValues is unavailable", async () => {
    const subtle = globalThis.crypto.subtle;
    vi.stubGlobal("crypto", { subtle });
    const crypto = new PassportFileWebCrypto();

    await expectAsyncResultError(
      encrypt(crypto, SECRET_KEY_BYTES, "not+decoded", "https://passport.pubky.app"),
      { code: "unsupported_browser_crypto" },
    );
  });

  it("decrypts when getRandomValues is unavailable", async () => {
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );

    const subtle = globalThis.crypto.subtle;
    vi.stubGlobal("crypto", { subtle });
    const secretKey = expectResultOk(
      await decrypt(
        new PassportFileWebCrypto(),
        envelope,
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
    );

    expect(secretKey).toEqual(SECRET_KEY_BYTES);
  });

  it("returns unsupported_browser_crypto during decrypt when WebCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    const crypto = new PassportFileWebCrypto();

    await expectAsyncResultError(
      decrypt(crypto, TEST_ENVELOPE, WRAPPING_KEY, "https://passport.pubky.app"),
      { code: "unsupported_browser_crypto" },
    );
  });

  it("preserves browser crypto capability probe exceptions without logging their contents", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new DOMException("SECRET-CRYPTO-PROVIDER", "SecurityError");
    vi.stubGlobal(
      "crypto",
      new Proxy(globalThis.crypto, {
        get(target, property, receiver) {
          if (property === "subtle") throw cause;
          return Reflect.get(target, property, receiver);
        },
      }),
    );

    const error = expectCryptoError(
      await encrypt(
        new PassportFileWebCrypto(),
        SECRET_KEY_BYTES,
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      "unsupported_browser_crypto",
    );

    expect(error.cause).toBe(cause);
    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "encrypt",
      code: "unsupported_browser_crypto",
      diagnosticId: expect.any(String),
      errorName: "SecurityError",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-CRYPTO-PROVIDER");
  });

  it("maps unsupported HKDF import to unsupported_browser_crypto", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new TypeError("SECRET-HKDF-FAILURE");
    vi.spyOn(SubtleCrypto.prototype, "importKey").mockRejectedValue(cause);
    const crypto = new PassportFileWebCrypto();

    const error = expectCryptoError(
      await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
      "unsupported_browser_crypto",
    );
    expect(error.cause).toBe(cause);
    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "encrypt",
      code: "unsupported_browser_crypto",
      diagnosticId: expect.any(String),
      errorName: "TypeError",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-HKDF-FAILURE");
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(encodeBase64Url(SECRET_KEY_BYTES));
  });

  it("logs encryption exceptions without retaining key material or exception details", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new Error("SECRET-ENCRYPT-FAILURE");
    vi.spyOn(SubtleCrypto.prototype, "encrypt").mockRejectedValue(cause);

    const error = expectCryptoError(
      await encrypt(
        new PassportFileWebCrypto(),
        SECRET_KEY_BYTES,
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      "encrypt_failed",
    );
    expect(error.cause).toBe(cause);

    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "encrypt",
      code: "encrypt_failed",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-ENCRYPT-FAILURE");
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(encodeBase64Url(SECRET_KEY_BYTES));
  });

  it("maps unsupported AES-GCM derivation to unsupported_browser_crypto", async () => {
    const cause = new DOMException("SECRET-AES-GCM-DERIVATION", "NotSupportedError");
    vi.spyOn(SubtleCrypto.prototype, "deriveKey").mockRejectedValue(cause);
    const crypto = new PassportFileWebCrypto();

    const error = expectCryptoError(
      await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
      "unsupported_browser_crypto",
    );
    expect(error.cause).toBe(cause);
  });

  it("encrypts a Pubky secret key into a v1 envelope", async () => {
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app/"),
    );

    expect(envelope.v).toBe(1);
    expect(envelope.url).toBe("https://passport.pubky.app");
    expect(envelope.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.ct).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.ct).not.toBe(encodeBase64Url(SECRET_KEY_BYTES));
    expectResultOk(parsePassportFileEnvelope(envelope));
  });

  it("authenticates the envelope key ID", async () => {
    const crypto = createCrypto();
    const encrypted = expectResultOk(
      await crypto.encryptSecretKeyBytes(
        SECRET_KEY_BYTES,
        WRAPPING_KEY,
        "https://passport.pubky.app",
        "2026-08",
      ),
    );

    expect(encrypted).toMatchObject({ v: 1, keyId: "2026-08" });
    expectResultOk(await decrypt(crypto, encrypted, WRAPPING_KEY, "https://passport.pubky.app"));
    const tampered = await decrypt(
      crypto,
      { ...encrypted, keyId: "2026-07" },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );
    expect(Result.isError(tampered) && tampered.error.code).toBe("decrypt_failed");
  });

  it("round-trips encrypted Pubky secret key bytes", async () => {
    const crypto = createCrypto();
    const envelope = expectResultOk(
      await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );
    const secretKey = expectResultOk(
      await decrypt(crypto, envelope, WRAPPING_KEY, "https://passport.pubky.app"),
    );

    expect(secretKey).toEqual(SECRET_KEY_BYTES);
  });

  it("encrypts a snapshot when the caller mutates its secret during key derivation", async () => {
    let continueDerivation = (): void => undefined;
    let markDerivationStarted = (): void => undefined;
    const derivationStarted = new Promise<void>((resolve) => {
      markDerivationStarted = resolve;
    });
    const derivationMayContinue = new Promise<void>((resolve) => {
      continueDerivation = resolve;
    });
    const subtle = globalThis.crypto.subtle;
    const nativeDeriveKey = subtle.deriveKey.bind(subtle);
    vi.spyOn(SubtleCrypto.prototype, "deriveKey").mockImplementation(
      async (
        ...args: Parameters<SubtleCrypto["deriveKey"]>
      ): ReturnType<SubtleCrypto["deriveKey"]> => {
        markDerivationStarted();
        await derivationMayContinue;
        return nativeDeriveKey(...args);
      },
    );
    const mutableSecret = Uint8Array.from(SECRET_KEY_BYTES);

    const pendingEncryption = encrypt(
      new PassportFileWebCrypto(),
      mutableSecret,
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );
    await derivationStarted;
    mutableSecret.fill(0);
    continueDerivation();

    const envelope = expectResultOk(await pendingEncryption);
    const secretKey = expectResultOk(
      await decrypt(createCrypto(), envelope, WRAPPING_KEY, "https://passport.pubky.app"),
    );
    expect(secretKey).toEqual(SECRET_KEY_BYTES);
  });

  it("uses a fresh IV for each encryption", async () => {
    const crypto = createCrypto();
    const first = expectResultOk(
      await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );
    const second = expectResultOk(
      await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );

    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
  });

  it("fails safely with a different wrapping key", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );
    const decrypted = await decrypt(
      createCrypto(),
      envelope,
      DIFFERENT_WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectCryptoError(decrypted, "decrypt_failed");
    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "decrypt",
      code: "decrypt_failed",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(DIFFERENT_WRAPPING_KEY);
    expect(logged).not.toContain(envelope.iv);
    expect(logged).not.toContain(envelope.ct);
  });

  it("logs decryption exceptions without retaining envelope or exception details", async () => {
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new RangeError("SECRET-DECRYPT-FAILURE");
    vi.spyOn(SubtleCrypto.prototype, "decrypt").mockRejectedValue(cause);

    const error = expectCryptoError(
      await decrypt(
        new PassportFileWebCrypto(),
        envelope,
        WRAPPING_KEY,
        "https://passport.pubky.app",
      ),
      "decrypt_failed",
    );
    expect(error.cause).toBe(cause);

    expect(warning).toHaveBeenCalledWith("passport_file.crypto.failed", {
      operation: "decrypt",
      code: "decrypt_failed",
      diagnosticId: expect.any(String),
      errorName: "RangeError",
    });
    expect(warning).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-DECRYPT-FAILURE");
    expect(logged).not.toContain(WRAPPING_KEY);
    expect(logged).not.toContain(envelope.iv);
    expect(logged).not.toContain(envelope.ct);
  });

  it("fails safely when ciphertext is tampered", async () => {
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );

    const decrypted = await decrypt(
      createCrypto(),
      { ...envelope, ct: tamperBase64Url(envelope.ct) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectCryptoError(decrypted, "decrypt_failed");
  });

  it("rejects an incorrectly sized IV before decryption", async () => {
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );

    const decrypted = await decrypt(
      createCrypto(),
      { ...envelope, iv: encodeBase64Url(new Uint8Array(11)) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectResultError(decrypted, {
      code: "invalid_envelope",
      cause: { code: "invalid_file" },
    });
  });

  it("fails authentication when a valid-length IV is tampered", async () => {
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );

    const decrypted = await decrypt(
      createCrypto(),
      { ...envelope, iv: tamperBase64Url(envelope.iv) },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectCryptoError(decrypted, "decrypt_failed");
  });

  it("rejects ciphertext that is not the v1 secret key and GCM tag size", async () => {
    const decrypted = await decrypt(
      createCrypto(),
      {
        v: 1,
        keyId: "current",
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: encodeBase64Url(new Uint8Array(PUBKY_SECRET_KEY_BYTES + 17)),
        url: "https://passport.pubky.app",
      },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectResultError(decrypted, {
      code: "invalid_envelope",
      cause: { code: "invalid_file" },
    });
  });

  it("clears rejected decrypted plaintext", async () => {
    const rejectedPlaintext = new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1).fill(7);
    vi.spyOn(SubtleCrypto.prototype, "decrypt").mockResolvedValue(rejectedPlaintext.buffer);
    const crypto = new PassportFileWebCrypto();

    await expectAsyncResultError(
      decrypt(
        crypto,
        {
          v: 1,
          keyId: "current",
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
    const decrypted = await decrypt(
      createCrypto(),
      {
        v: 1,
        keyId: "current",
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: "A".repeat(1024 * 1024),
        url: "https://passport.pubky.app",
      },
      WRAPPING_KEY,
      "https://passport.pubky.app",
    );

    expectResultError(decrypted, {
      code: "invalid_envelope",
      cause: { code: "invalid_file" },
    });
  });

  it("fails safely when authenticated envelope metadata is tampered", async () => {
    const envelope = expectResultOk(
      await encrypt(createCrypto(), SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app"),
    );

    const decrypted = await decrypt(
      createCrypto(),
      { ...envelope, url: "https://passport-staging.pubky.app" },
      WRAPPING_KEY,
      "https://passport-staging.pubky.app",
    );

    expectCryptoError(decrypted, "decrypt_failed");
  });

  it("rejects an envelope created for a different Passport origin", async () => {
    const envelope = expectResultOk(
      await encrypt(
        createCrypto(),
        SECRET_KEY_BYTES,
        WRAPPING_KEY,
        "https://passport-staging.pubky.app",
      ),
    );

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
      encrypt(crypto, SECRET_KEY_BYTES, "A".repeat(1024 * 1024), "https://passport.pubky.app"),
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

    const error = expectCryptoError(
      await encrypt(crypto, SECRET_KEY_BYTES, WRAPPING_KEY, "https://passport.pubky.app/path"),
      "invalid_envelope",
    );
    expect(error.cause).toEqual({ code: "invalid_field", field: "url" });
  });
});

function expectCryptoError<Success>(
  result: ResultType<Success, { code: string; cause?: unknown }>,
  code: string,
): { code: string; cause?: unknown } {
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) throw new Error(`Expected ${code}.`);
  expect(result.error.code).toBe(code);
  return result.error;
}
