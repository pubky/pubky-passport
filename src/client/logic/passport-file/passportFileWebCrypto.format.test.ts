import { createCipheriv, hkdfSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { PassportFileWebCrypto } from "./PassportFileWebCrypto";

const iv = new Uint8Array(12);

afterEach(() => vi.restoreAllMocks());

describe("Passport-file crypto compatibility and ownership", () => {
  it("keeps the v1 Passport-file ciphertext byte-for-byte compatible with node:crypto", async () => {
    const wrappingKey = new Uint8Array(32).fill(17);
    const seed = new Uint8Array(32).fill(29);
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).fill(0);
      return array;
    });
    const envelope = expectResultOk(
      await new PassportFileWebCrypto().encryptSecretKeyBytes(
        seed,
        encodeBase64Url(wrappingKey),
        "https://passport.example/",
        "current",
      ),
    );
    const key = hkdfSync(
      "sha256",
      wrappingKey,
      Buffer.from("pubky-passport/passport-file/aes-gcm/salt/v1"),
      Buffer.from("passport-file:aes-gcm:v1"),
      32,
    );
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv);
    cipher.setAAD(
      Buffer.from("pubky-passport/passport-file/v1\nhttps://passport.example\ncurrent"),
    );
    const ciphertext = Buffer.concat([cipher.update(seed), cipher.final(), cipher.getAuthTag()]);
    expect(envelope).toEqual({
      v: 1,
      keyId: "current",
      iv: encodeBase64Url(iv),
      ct: encodeBase64Url(ciphertext),
      url: "https://passport.example",
    });
  });

  it("decrypts a fixed existing v1 envelope independently built with node:crypto", async () => {
    const envelope = {
      v: 1 as const,
      keyId: "current",
      iv: "AAAAAAAAAAAAAAAA",
      ct: "QOIX0DnJ98rQobYT_Kt2ZGVf3IWnEeqPBPaIeOBvKHp8m6X1y0wynjfGs2sK6V9T",
      url: "https://passport.example",
    };
    const result = await new PassportFileWebCrypto().decryptSecretKeyBytes(
      envelope,
      encodeBase64Url(new Uint8Array(32).fill(17)),
    );
    const plaintext = expectResultOk(result);
    expect(plaintext).toEqual(new Uint8Array(32).fill(29));
    plaintext.fill(0);
  });

  it.each([false, true])(
    "clears every seed snapshot on encrypt failure=%s, retaining the caller's bytes",
    async (fails) => {
      const seed = new Uint8Array(32).fill(29);
      const wrappingKey = encodeBase64Url(new Uint8Array(32).fill(17));
      const copies: Uint8Array[] = [];
      const from = Uint8Array.from;
      vi.spyOn(Uint8Array, "from").mockImplementation((...args) => {
        const copy = Reflect.apply(from, Uint8Array, args) as Uint8Array<ArrayBuffer>;
        if (copy.length === seed.length && copy.every((byte, index) => byte === seed[index]))
          copies.push(copy);
        return copy;
      });
      const cause = new Error("synthetic encryption failure");
      if (fails) vi.spyOn(crypto.subtle, "encrypt").mockRejectedValue(cause);
      const result = await new PassportFileWebCrypto().encryptSecretKeyBytes(
        seed,
        wrappingKey,
        "https://passport.example",
        "current",
      );
      if (fails) expectResultError(result, { code: "encrypt_failed", cause });
      else expectResultOk(result);
      expect(copies.length).toBeGreaterThanOrEqual(2);
      expect(copies.every((copy) => copy.every((byte) => byte === 0))).toBe(true);
      expect(seed).toEqual(new Uint8Array(32).fill(29));
    },
  );

  it.each(["snapshot", "random source"])(
    "contains a %s failure and keeps the caller seed",
    async (stage) => {
      const seed = new Uint8Array(32).fill(29);
      const wrappingKey = encodeBase64Url(new Uint8Array(32).fill(17));
      const cause = new Error(`synthetic ${stage} failure`);
      const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const decoded: Uint8Array[] = [];
      if (stage === "snapshot") {
        const from = Uint8Array.from;
        vi.spyOn(Uint8Array, "from").mockImplementation((...args) => {
          if (args[0] === seed) throw cause;
          const copy = Reflect.apply(from, Uint8Array, args) as Uint8Array<ArrayBuffer>;
          if (typeof args[0] === "string") decoded.push(copy);
          return copy;
        });
      } else
        vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
          throw cause;
        });
      expectResultError(
        await new PassportFileWebCrypto().encryptSecretKeyBytes(
          seed,
          wrappingKey,
          "https://passport.example",
          "current",
        ),
        { code: "encrypt_failed", cause },
      );
      expect(warn).toHaveBeenCalledExactlyOnceWith("passport_file.crypto.failed", {
        operation: "encrypt",
        code: "encrypt_failed",
        diagnosticId: expect.any(String),
        errorName: "Error",
      });
      if (stage === "snapshot") {
        expect(decoded).toHaveLength(1);
        expect(decoded[0]).toEqual(new Uint8Array(32));
      }
      expect(seed).toEqual(new Uint8Array(32).fill(29));
    },
  );

  it("contains a decrypt AAD encoding failure with the original cause and safe log", async () => {
    const cause = new Error("synthetic encoding failure");
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const encode = TextEncoder.prototype.encode;
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (
      this: TextEncoder,
      input?: string,
    ) {
      if (input?.startsWith("pubky-passport/passport-file/v1\n")) throw cause;
      return encode.call(this, input);
    });
    expectResultError(
      await new PassportFileWebCrypto().decryptSecretKeyBytes(
        {
          v: 1,
          keyId: "current",
          iv: "AAAAAAAAAAAAAAAA",
          ct: "QOIX0DnJ98rQobYT_Kt2ZGVf3IWnEeqPBPaIeOBvKHp8m6X1y0wynjfGs2sK6V9T",
          url: "https://passport.example",
        },
        encodeBase64Url(new Uint8Array(32).fill(17)),
      ),
      { code: "decrypt_failed", cause },
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith("passport_file.crypto.failed", {
      operation: "decrypt",
      code: "decrypt_failed",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
  });

  it.each(["encrypt", "decrypt"] as const)(
    "does not invent diagnostic metadata for a cause-less %s rejection",
    async (operation) => {
      const service = new PassportFileWebCrypto();
      const seed = new Uint8Array(32).fill(29);
      const wrappingKey = encodeBase64Url(new Uint8Array(32).fill(17));
      const envelope = expectResultOk(
        await service.encryptSecretKeyBytes(
          seed,
          wrappingKey,
          "https://passport.example",
          "current",
        ),
      );
      const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      vi.spyOn(crypto.subtle, operation).mockRejectedValueOnce(undefined);
      const result =
        operation === "encrypt"
          ? await service.encryptSecretKeyBytes(
              seed,
              wrappingKey,
              "https://passport.example",
              "current",
            )
          : await service.decryptSecretKeyBytes(envelope, wrappingKey);
      expectResultError<unknown, unknown>(result, { code: `${operation}_failed` });
      expect(warn).toHaveBeenCalledExactlyOnceWith("passport_file.crypto.failed", {
        operation,
        code: `${operation}_failed`,
      });
    },
  );
});
