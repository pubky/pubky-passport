import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parsePassportFileEnvelope } from "../../../core/pipes/passport-file/parsePassportFile";
import {
  decodeBase64Url,
  encodeBase64Url,
  WebCryptoPassportFileCrypto,
} from "./webCryptoPassportFileCrypto";

const recoveryFileBytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);

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
  it("encrypts a recovery file into a v1 envelope", async () => {
    const result = await createCrypto().encryptRecoveryFileBytes({
      recoveryFileBytes,
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
    expect(result.value.ct).not.toBe(encodeBase64Url(recoveryFileBytes));
    expect(parsePassportFileEnvelope(result.value).ok).toBe(true);
  });

  it("round-trips encrypted recovery file bytes", async () => {
    const crypto = createCrypto();
    const encrypted = await crypto.encryptRecoveryFileBytes({
      recoveryFileBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await crypto.decryptRecoveryFileBytes({ envelope: encrypted.value, wrappingKey });

    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) {
      throw new Error(decrypted.error.code);
    }

    expect(decrypted.value).toEqual(recoveryFileBytes);
  });

  it("uses a fresh IV for each encryption", async () => {
    const crypto = createCrypto();
    const first = await crypto.encryptRecoveryFileBytes({ recoveryFileBytes, wrappingKey, passportUrl: "https://passport.pubky.app" });
    const second = await crypto.encryptRecoveryFileBytes({ recoveryFileBytes, wrappingKey, passportUrl: "https://passport.pubky.app" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("encryption failed");
    }

    expect(first.value.iv).not.toBe(second.value.iv);
    expect(first.value.ct).not.toBe(second.value.ct);
  });

  it("fails safely with a different wrapping key", async () => {
    const encrypted = await createCrypto().encryptRecoveryFileBytes({
      recoveryFileBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptRecoveryFileBytes({
      envelope: encrypted.value,
      wrappingKey: differentWrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "decrypt_failed" } });
  });

  it("fails safely when ciphertext is tampered", async () => {
    const encrypted = await createCrypto().encryptRecoveryFileBytes({
      recoveryFileBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptRecoveryFileBytes({
      envelope: { ...encrypted.value, ct: tamperBase64Url(encrypted.value.ct) },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "decrypt_failed" } });
  });

  it("fails safely when IV is tampered", async () => {
    const encrypted = await createCrypto().encryptRecoveryFileBytes({
      recoveryFileBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptRecoveryFileBytes({
      envelope: { ...encrypted.value, iv: encodeBase64Url(new Uint8Array(11)) },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "invalid_envelope" } });
  });

  it("fails safely when authenticated envelope metadata is tampered", async () => {
    const encrypted = await createCrypto().encryptRecoveryFileBytes({
      recoveryFileBytes,
      wrappingKey,
      passportUrl: "https://passport.pubky.app",
    });

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) {
      throw new Error(encrypted.error.code);
    }

    const decrypted = await createCrypto().decryptRecoveryFileBytes({
      envelope: { ...encrypted.value, url: "https://passport-staging.pubky.app" },
      wrappingKey,
    });

    expect(decrypted).toEqual({ ok: false, error: { code: "decrypt_failed" } });
  });

  it("rejects invalid wrapping keys", async () => {
    const crypto = createCrypto();

    await expect(
      crypto.encryptRecoveryFileBytes({ recoveryFileBytes, wrappingKey: "not+base64url", passportUrl: "https://passport.pubky.app" }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_wrapping_key" } });

    await expect(
      crypto.encryptRecoveryFileBytes({
        recoveryFileBytes,
        wrappingKey: encodeBase64Url(new Uint8Array(31)),
        passportUrl: "https://passport.pubky.app",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_wrapping_key" } });
  });

  it("rejects invalid plaintext and envelope inputs", async () => {
    const crypto = createCrypto();

    await expect(
      crypto.encryptRecoveryFileBytes({
        recoveryFileBytes: new Uint8Array(),
        wrappingKey,
        passportUrl: "https://passport.pubky.app",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_plaintext" } });

    await expect(
      crypto.encryptRecoveryFileBytes({ recoveryFileBytes, wrappingKey, passportUrl: "https://passport.pubky.app/path" }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_envelope" } });
  });

  it("derives deterministic domain-separated recovery passphrases", async () => {
    const crypto = createCrypto();
    const first = await crypto.deriveRecoveryPassphrase({ wrappingKey });
    const second = await crypto.deriveRecoveryPassphrase({ wrappingKey });
    const third = await crypto.deriveRecoveryPassphrase({ wrappingKey: differentWrappingKey });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) {
      throw new Error("passphrase derivation failed");
    }

    expect(first.value).toBe(second.value);
    expect(first.value).not.toBe(third.value);
    expect(first.value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBase64Url(first.value).ok).toBe(true);
  });

  it("maps passphrase derivation wrapping-key failures safely", async () => {
    await expect(createCrypto().deriveRecoveryPassphrase({ wrappingKey: "invalid=" })).resolves.toEqual({
      ok: false,
      error: { code: "invalid_wrapping_key" },
    });
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
