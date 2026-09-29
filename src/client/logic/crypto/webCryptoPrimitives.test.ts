import { createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import * as primitives from "./webCryptoPrimitives";
import {
  aesGcmDecrypt,
  aesGcmEncryptWithRandomIv,
  copyToArrayBuffer,
  decodeFixedLengthBase64Url,
  deriveAesGcmKeyWithHkdf,
  getBrowserCrypto,
} from "./webCryptoPrimitives";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const salt = bytes("000102030405060708090a0b0c");
const info = bytes("f0f1f2f3f4f5f6f7f8f9");
const iv = new Uint8Array(12);
const additionalData = new Uint8Array();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function encryptWithTestIv(
  subtle: SubtleCrypto,
  key: CryptoKey,
  plaintext: Uint8Array,
  parameters: { iv: Uint8Array; additionalData: Uint8Array },
) {
  const encrypted = await aesGcmEncryptWithRandomIv(
    { getRandomValues: <T extends ArrayBufferView | null>() => parameters.iv as unknown as T },
    subtle,
    key,
    plaintext,
    parameters.additionalData,
  );
  return Result.isError(encrypted) ? encrypted : Result.ok(encrypted.value.ciphertext);
}

describe("shared WebCrypto primitives", () => {
  it("exports only the fresh-IV encryption entry point", () => {
    expect(primitives).not.toHaveProperty("aesGcmEncrypt");
  });
  it.each([11, 13])("rejects a %i-byte IV before either AES operation", async (length) => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    const encrypt = vi.spyOn(crypto.subtle, "encrypt");
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    const parameters = { iv: new Uint8Array(length), additionalData };
    expectResultError(await encryptWithTestIv(crypto.subtle, key, new Uint8Array(32), parameters), {
      code: "encrypt_failed",
    });
    expectResultError(await aesGcmDecrypt(crypto.subtle, key, new Uint8Array(48), parameters), {
      code: "decrypt_failed",
    });
    expect(encrypt).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("generates a fresh 12-byte IV for every random-IV encryption", async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    const plaintext = new Uint8Array(32).fill(8);
    const first = expectResultOk(
      await aesGcmEncryptWithRandomIv(crypto, crypto.subtle, key, plaintext, additionalData),
    );
    const second = expectResultOk(
      await aesGcmEncryptWithRandomIv(crypto, crypto.subtle, key, plaintext, additionalData),
    );
    expect(first.iv).toHaveLength(12);
    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(
      expectResultOk(
        await aesGcmDecrypt(crypto.subtle, key, first.ciphertext, { iv: first.iv, additionalData }),
      ),
    ).toEqual(plaintext);
    expect(
      expectResultOk(
        await aesGcmDecrypt(crypto.subtle, key, second.ciphertext, {
          iv: second.iv,
          additionalData,
        }),
      ),
    ).toEqual(plaintext);
  });

  it("uses its injected random source and authenticates nonempty AAD", async () => {
    const rawKey = new Uint8Array(32).fill(3);
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const random = {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        (array as Uint8Array).fill(7);
        return array;
      },
    };
    const plaintext = new Uint8Array(32).fill(8);
    const aad = new TextEncoder().encode("synthetic domain");
    const sealed = expectResultOk(
      await aesGcmEncryptWithRandomIv(random, crypto.subtle, key, plaintext, aad),
    );
    const expectedIv = new Uint8Array(12).fill(7);
    expect(sealed.iv).toEqual(expectedIv);
    const reference = createCipheriv("aes-256-gcm", rawKey, expectedIv);
    reference.setAAD(aad);
    expect(sealed.ciphertext).toEqual(
      new Uint8Array(
        Buffer.concat([reference.update(plaintext), reference.final(), reference.getAuthTag()]),
      ),
    );
  });

  it.each(["random source", "encryption"])(
    "contains a %s failure in random-IV encryption",
    async (stage) => {
      const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
        "encrypt",
      ]);
      const cause = new Error(`synthetic ${stage} failure`);
      if (stage === "random source") {
        vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
          throw cause;
        });
      } else {
        vi.spyOn(crypto.subtle, "encrypt").mockRejectedValue(cause);
      }
      expectResultError(
        await aesGcmEncryptWithRandomIv(
          crypto,
          crypto.subtle,
          key,
          new Uint8Array(32),
          additionalData,
        ),
        { code: "encrypt_failed", cause },
      );
    },
  );

  it("returns a Result and clears IKM if its input copy fails", async () => {
    const cause = new Error("synthetic allocation failure");
    const ikm = new Uint8Array(32).fill(3);
    vi.spyOn(Uint8Array, "from").mockImplementationOnce(() => {
      throw cause;
    });
    expectResultError(
      await deriveAesGcmKeyWithHkdf(crypto.subtle, ikm, { salt, info, usages: ["encrypt"] }),
      { code: "unsupported_browser_crypto", cause },
    );
    expect(ikm).toEqual(new Uint8Array(32));
  });

  it("returns a Result and retains caller plaintext if its input copy fails", async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
      "encrypt",
    ]);
    const cause = new Error("synthetic allocation failure");
    const plaintext = new Uint8Array(32).fill(3);
    vi.spyOn(Uint8Array, "from").mockImplementationOnce(() => {
      throw cause;
    });
    expectResultError(
      await encryptWithTestIv(crypto.subtle, key, plaintext, { iv, additionalData }),
      {
        code: "encrypt_failed",
        cause,
      },
    );
    expect(plaintext).toEqual(new Uint8Array(32).fill(3));
  });

  it("matches McGrew-Viega GCM test case 16 with nonzero IV and AAD in both directions", async () => {
    const rawKey = bytes("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308");
    const nonce = bytes("cafebabefacedbaddecaf888");
    const aad = bytes("feedfacedeadbeeffeedfacedeadbeefabaddad2");
    const plaintext = bytes(
      "d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39",
    );
    const expected = bytes(
      "522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f66276fc6ece0f4e1768cddf8853bb2d551b",
    );
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    expect(
      expectResultOk(
        await encryptWithTestIv(crypto.subtle, key, plaintext, { iv: nonce, additionalData: aad }),
      ),
    ).toEqual(expected);
    expect(
      expectResultOk(
        await aesGcmDecrypt(crypto.subtle, key, expected, { iv: nonce, additionalData: aad }),
      ),
    ).toEqual(plaintext);
    const cipher = createCipheriv("aes-256-gcm", rawKey, nonce);
    cipher.setAAD(aad);
    expect(
      Uint8Array.from(
        Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]),
      ),
    ).toEqual(expected);
    const decipher = createDecipheriv("aes-256-gcm", rawKey, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(expected.subarray(-16));
    expect(
      Uint8Array.from(
        Buffer.concat([decipher.update(expected.subarray(0, -16)), decipher.final()]),
      ),
    ).toEqual(plaintext);
  });

  it("matches RFC 5869 case 1 and uses its first 256 bits as a non-extractable AES key", async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const okm = bytes(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
    expect(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 42))).toEqual(okm);
    const key = expectResultOk(
      await deriveAesGcmKeyWithHkdf(crypto.subtle, ikm, {
        salt,
        info,
        usages: ["encrypt", "decrypt"],
      }),
    );
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    expect(key.usages).toEqual(["encrypt", "decrypt"]);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    const plaintext = new Uint8Array(32).fill(0x31);
    const cipher = createCipheriv("aes-256-gcm", okm.subarray(0, 32), iv);
    const expected = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    expect(
      expectResultOk(
        await encryptWithTestIv(crypto.subtle, key, plaintext, { iv, additionalData }),
      ),
    ).toEqual(Uint8Array.from(expected));
    expect(ikm).toEqual(new Uint8Array(22));
  });

  it("matches McGrew-Viega GCM test case 14 (AES-256) in both directions and node:crypto", async () => {
    const rawKey = new Uint8Array(32);
    const plaintext = new Uint8Array(16);
    const expected = bytes("cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919");
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    const encrypted = expectResultOk(
      await encryptWithTestIv(crypto.subtle, key, plaintext, { iv, additionalData }),
    );
    expect(encrypted).toEqual(expected);
    expect(
      expectResultOk(await aesGcmDecrypt(crypto.subtle, key, expected, { iv, additionalData })),
    ).toEqual(plaintext);
    const cipher = createCipheriv("aes-256-gcm", rawKey, iv);
    expect(
      Uint8Array.from(
        Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]),
      ),
    ).toEqual(expected);
    const decipher = createDecipheriv("aes-256-gcm", rawKey, iv);
    decipher.setAuthTag(expected.subarray(16));
    expect(
      Uint8Array.from(Buffer.concat([decipher.update(expected.subarray(0, 16)), decipher.final()])),
    ).toEqual(plaintext);
  });

  it.each<KeyUsage[]>([["encrypt", "unwrapKey"], ["unwrapKey"]])(
    "preserves the caller's restricted key usages %j",
    async (...usages) => {
      const key = expectResultOk(
        await deriveAesGcmKeyWithHkdf(crypto.subtle, new Uint8Array(32), { salt, info, usages }),
      );
      expect(key.usages).toEqual(usages);
      expect(key.extractable).toBe(false);
    },
  );

  it("clears the IKM and its import copy before derivation starts", async () => {
    const ikm = new Uint8Array(32).fill(7);
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    const deriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
    let imported: ArrayBuffer | undefined;
    vi.spyOn(crypto.subtle, "importKey").mockImplementation(async (...args) => {
      imported = args[1] as ArrayBuffer;
      expect(new Uint8Array(imported)).toEqual(ikm);
      const key = await importKey(...args);
      expect(key.extractable).toBe(false);
      expect(key.usages).toEqual(["deriveKey"]);
      return key;
    });
    vi.spyOn(crypto.subtle, "deriveKey").mockImplementation(async (...args) => {
      expect(ikm).toEqual(new Uint8Array(32));
      expect(new Uint8Array(imported!)).toEqual(new Uint8Array(32));
      return deriveKey(...args);
    });
    expectResultOk(
      await deriveAesGcmKeyWithHkdf(crypto.subtle, ikm, { salt, info, usages: ["encrypt"] }),
    );
    expect(crypto.subtle.deriveKey).toHaveBeenCalledOnce();
  });

  it.each(["importKey", "deriveKey"] as const)(
    "clears IKM and preserves a %s failure cause",
    async (method) => {
      const cause = new Error("synthetic failure");
      const ikm = new Uint8Array(32).fill(9);
      let imported: ArrayBuffer | undefined;
      const importKey = crypto.subtle.importKey.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, "importKey").mockImplementation(async (...args) => {
        imported = args[1] as ArrayBuffer;
        if (method === "importKey") throw cause;
        return importKey(...args);
      });
      if (method === "deriveKey") vi.spyOn(crypto.subtle, "deriveKey").mockRejectedValue(cause);
      const result = await deriveAesGcmKeyWithHkdf(crypto.subtle, ikm, {
        salt,
        info,
        usages: ["encrypt"],
      });
      expectResultError(result, { code: "unsupported_browser_crypto", cause });
      expect(ikm).toEqual(new Uint8Array(32));
      expect(new Uint8Array(imported!)).toEqual(new Uint8Array(32));
    },
  );

  it.each([false, true])(
    "clears the encryption snapshot on failure=%s, retaining the caller's bytes",
    async (fails) => {
      const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
        "encrypt",
      ]);
      const plaintext = new Uint8Array(32).fill(11);
      const cause = new Error("synthetic encryption failure");
      let snapshot: ArrayBuffer | undefined;
      vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (_algorithm, _key, data) => {
        snapshot = data as ArrayBuffer;
        expect(snapshot).not.toBe(plaintext.buffer);
        expect(new Uint8Array(snapshot)).toEqual(plaintext);
        if (fails) throw cause;
        return new ArrayBuffer(48);
      });
      const result = await encryptWithTestIv(crypto.subtle, key, plaintext, { iv, additionalData });
      if (fails) expectResultError(result, { code: "encrypt_failed", cause });
      else expectResultOk(result);
      expect(new Uint8Array(snapshot!)).toEqual(new Uint8Array(32));
      expect(plaintext).toEqual(new Uint8Array(32).fill(11));
    },
  );

  it.each(["iv", "additionalData", "ciphertext"] as const)(
    "rejects tampered %s without returning plaintext",
    async (field) => {
      const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
      const parameters = { iv: new Uint8Array(12), additionalData: new Uint8Array(5) };
      const ciphertext = expectResultOk(
        await encryptWithTestIv(crypto.subtle, key, new Uint8Array(32), parameters),
      );
      if (field === "ciphertext") ciphertext[0] = 1;
      else parameters[field][0] = 1;
      expectResultError(await aesGcmDecrypt(crypto.subtle, key, ciphertext, parameters), {
        code: "decrypt_failed",
        cause: expect.any(Error),
      });
    },
  );

  it("preserves the decryption failure cause", async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, [
      "decrypt",
    ]);
    const cause = new Error("synthetic decryption failure");
    vi.spyOn(crypto.subtle, "decrypt").mockRejectedValue(cause);
    expectResultError(
      await aesGcmDecrypt(crypto.subtle, key, new Uint8Array(48), { iv, additionalData }),
      { code: "decrypt_failed", cause },
    );
  });

  it("accepts only canonical base64url of the exact length before decoding", () => {
    const decode = vi.spyOn(globalThis, "atob");
    expect(decodeFixedLengthBase64Url("A".repeat(10000), 32)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(decodeFixedLengthBase64Url("AA=", 2)).toBeNull();
    expect(decodeFixedLengthBase64Url("AB", 1)).toBeNull();
    expect(decodeFixedLengthBase64Url("++", 1)).toBeNull();
    expect(decodeFixedLengthBase64Url("_w", 1)).toEqual(new Uint8Array([255]));
  });

  it("copies only the selected bytes of a subarray", () => {
    const original = new Uint8Array([9, 1, 2, 9]);
    const copy = copyToArrayBuffer(original.subarray(1, 3));
    original.fill(0);
    expect(new Uint8Array(copy)).toEqual(new Uint8Array([1, 2]));
  });

  it("probes crypto without requiring a random source and preserves getter errors", () => {
    const subtle = crypto.subtle;
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { subtle });
    expect(expectResultOk(getBrowserCrypto()).subtle).toBe(subtle);
    vi.stubGlobal("crypto", { getRandomValues });
    expectResultError(getBrowserCrypto(), { code: "unsupported_browser_crypto" });
    vi.stubGlobal("crypto", undefined);
    expectResultError(getBrowserCrypto(), { code: "unsupported_browser_crypto" });
    const cause = new Error("synthetic getter failure");
    vi.stubGlobal("crypto", {
      get subtle() {
        throw cause;
      },
    });
    expectResultError(getBrowserCrypto(), { code: "unsupported_browser_crypto", cause });
  });
});
