import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { pubkySecretKeyBytes } from "../../../core/domain/identity/pubkyIdentity";
import { parsePassportFileEnvelope } from "../../../core/pipes/passport-file/parsePassportFile";
import {
  decodeBase64Url,
  encodeBase64Url,
  WebCryptoPassportFileCrypto,
} from "./webCryptoPassportFileCrypto";

const secretKeyBytes = new Uint8Array(Array.from({ length: pubkySecretKeyBytes }, (_, index) => index + 11));

const wrappingKey = encodeBase64Url(new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)));
const differentWrappingKey = encodeBase64Url(new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index)));

function createCrypto(): WebCryptoPassportFileCrypto {
  return new WebCryptoPassportFileCrypto();
}

function tamperBase64Url(value: string): string {
  const replacement = value[0] === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

describe("WebCryptoPassportFileCrypto", () => {
  it("does not throw when browser crypto dependencies are unavailable", () => {
    expect(() => new WebCryptoPassportFileCrypto({ subtle: null, getRandomValues: null })).not.toThrow();
  });

  it("returns unsupported_browser_crypto when SubtleCrypto is unavailable", async () => {
    const crypto = new WebCryptoPassportFileCrypto({ subtle: null });

    await expect(
      crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey: "not+decoded", passportUrl: "https://passport.pubky.app" }),
    ).resolves.toEqual({ ok: false, error: { code: "unsupported_browser_crypto" } });
  });

  it("returns unsupported_browser_crypto when getRandomValues is unavailable", async () => {
    const crypto = new WebCryptoPassportFileCrypto({ getRandomValues: null });

    await expect(
      crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey: "not+decoded", passportUrl: "https://passport.pubky.app" }),
    ).resolves.toEqual({ ok: false, error: { code: "unsupported_browser_crypto" } });
  });

  it("returns unsupported_browser_crypto during decrypt when WebCrypto is unavailable", async () => {
    const crypto = new WebCryptoPassportFileCrypto({ subtle: null, getRandomValues: null });

    await expect(
      crypto.decryptSecretKeyBytes({
        envelope: {
          v: 1,
          iv: encodeBase64Url(new Uint8Array(12)),
          ct: encodeBase64Url(new Uint8Array([1])),
          url: "https://passport.pubky.app",
        },
        wrappingKey: "not+decoded",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "unsupported_browser_crypto" } });
  });

  it("maps unsupported HKDF import to unsupported_browser_crypto", async () => {
    const subtle = {
      decrypt: globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle),
      deriveKey: globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle),
      encrypt: globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle),
      importKey: async (): Promise<CryptoKey> => {
        throw new Error("HKDF unsupported");
      },
    } as unknown as SubtleCrypto;
    const crypto = new WebCryptoPassportFileCrypto({ subtle });

    await expect(
      crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey, passportUrl: "https://passport.pubky.app" }),
    ).resolves.toEqual({ ok: false, error: { code: "unsupported_browser_crypto" } });
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
    const crypto = new WebCryptoPassportFileCrypto({ subtle });

    await expect(
      crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey, passportUrl: "https://passport.pubky.app" }),
    ).resolves.toEqual({ ok: false, error: { code: "unsupported_browser_crypto" } });
  });

  it("encrypts a Pubky secret key into a v1 envelope", async () => {
    const result = await createCrypto().encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app/",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.value.v).toBe(1);
    expect(result.value.url).toBe("https://passport.pubky.app");
    expect(result.value.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.value.ct).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.value.ct).not.toBe(encodeBase64Url(secretKeyBytes));
    expect(parsePassportFileEnvelope(result.value).ok).toBe(true);
  });

  it("round-trips encrypted Pubky secret key bytes", async () => {
    const crypto = createCrypto();
    const encrypted = await crypto.encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await crypto.decryptSecretKeyBytes({ envelope: encrypted.value, wrappingKey });

    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) {
      throw new Error(decrypted.error.code);
    }

    expect(decrypted.value).toEqual(secretKeyBytes);
  });

  it("uses a fresh IV for each encryption", async () => {
    const crypto = createCrypto();
    const first = await crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey, passportUrl: "https://passport.pubky.app" });
    const second = await crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey, passportUrl: "https://passport.pubky.app" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("encryption failed");
    }

    expect(first.value.iv).not.toBe(second.value.iv);
    expect(first.value.ct).not.toBe(second.value.ct);
  });

  it("fails safely with a different wrapping key", async () => {
    const encrypted = await createCrypto().encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptSecretKeyBytes({
      envelope: encrypted.value,
      wrappingKey: differentWrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "decrypt_failed" } });
  });

  it("fails safely when ciphertext is tampered", async () => {
    const encrypted = await createCrypto().encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptSecretKeyBytes({
      envelope: { ...encrypted.value, ct: tamperBase64Url(encrypted.value.ct) },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "decrypt_failed" } });
  });

  it("fails safely when IV is tampered", async () => {
    const encrypted = await createCrypto().encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptSecretKeyBytes({
      envelope: { ...encrypted.value, iv: encodeBase64Url(new Uint8Array(11)) },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "invalid_envelope" } });
  });

  it("rejects ciphertext that is not the v1 secret key and GCM tag size", async () => {
    const decrypted = await createCrypto().decryptSecretKeyBytes({
      envelope: {
        v: 1,
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: encodeBase64Url(new Uint8Array(pubkySecretKeyBytes + 17)),
        url: "https://passport.pubky.app",
      },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "invalid_envelope" } });
  });

  it("rejects overlong base64url ciphertext before decoding it", async () => {
    const decrypted = await createCrypto().decryptSecretKeyBytes({
      envelope: {
        v: 1,
        iv: encodeBase64Url(new Uint8Array(12)),
        ct: "A".repeat(1024 * 1024),
        url: "https://passport.pubky.app",
      },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "invalid_envelope" } });
  });

  it("fails safely when authenticated envelope metadata is tampered", async () => {
    const encrypted = await createCrypto().encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptSecretKeyBytes({
      envelope: { ...encrypted.value, url: "https://passport-staging.pubky.app" },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "decrypt_failed" } });
  });

  it("rejects invalid wrapping keys", async () => {
    const crypto = createCrypto();

    await expect(
      crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey: "not+base64url", passportUrl: "https://passport.pubky.app" }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_wrapping_key" } });

    await expect(
      crypto.encryptSecretKeyBytes({
        secretKeyBytes,
        wrappingKey: encodeBase64Url(new Uint8Array(31)),
        passportUrl: "https://passport.pubky.app",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_wrapping_key" } });
  });

  it("rejects invalid plaintext and envelope inputs", async () => {
    const crypto = createCrypto();

    await expect(
      crypto.encryptSecretKeyBytes({
        secretKeyBytes: new Uint8Array(pubkySecretKeyBytes - 1),
        wrappingKey,
        passportUrl: "https://passport.pubky.app",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_plaintext" } });

    await expect(
      crypto.encryptSecretKeyBytes({ secretKeyBytes, wrappingKey, passportUrl: "https://passport.pubky.app/path" }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_envelope" } });
  });

});

describe("base64url helpers", () => {
  it("round-trips unpadded base64url bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 252, 253, 254, 255]);
    const encoded = encodeBase64Url(bytes);

    expect(encoded).toBe("AAEC_P3-_w");
    expect(encoded).not.toContain("=");
    expect(decodeBase64Url(encoded)).toEqual({ ok: true, value: bytes });
  });

  it("rejects invalid base64url strings", () => {
    for (const value of ["", "abc+", "abc/", "abc=", "A"]) {
      expect(decodeBase64Url(value)).toEqual({ ok: false, error: { code: "invalid_envelope" } });
    }
  });
});

describe("browser storage safety", () => {
  it("does not persist crypto material in browser storage APIs", () => {
    const source = readFileSync(fileURLToPath(new URL("./webCryptoPassportFileCrypto.ts", import.meta.url)), "utf8");

    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("indexedDB");
  });
});
