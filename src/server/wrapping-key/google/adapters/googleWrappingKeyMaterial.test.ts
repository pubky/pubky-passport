import { describe, expect, it } from "vitest";

import { createGoogleWrappingKeyMaterial } from "./googleWrappingKeyMaterial";

const serverSecretBase64 = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
).toString("base64");

const identity = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};

describe("wrapping-key material", () => {
  it("preserves the frozen Google HKDF fixture", async () => {
    const material = createGoogleWrappingKeyMaterial({ serverSecretBase64 });

    await expect(material.deriveWrappingKey(identity)).resolves.toEqual({
      wrappingKey: "0Rvmd96LjmVRcQ7WjvQBSUKwlI1YHO_4xmqDELjAGOE",
    });
  });

  it("derives distinct material for distinct subjects", async () => {
    const material = createGoogleWrappingKeyMaterial({ serverSecretBase64 });

    const first = await material.deriveWrappingKey(identity);
    const second = await material.deriveWrappingKey({ ...identity, subject: "other-google-subject" });

    expect(first.wrappingKey).not.toBe(second.wrappingKey);
  });

  it("rejects invalid server secret configuration", () => {
    expect(() => createGoogleWrappingKeyMaterial({ serverSecretBase64: "not-base64!" })).toThrow(
      "Invalid wrapping key configuration.",
    );
    expect(() => createGoogleWrappingKeyMaterial({ serverSecretBase64: Buffer.alloc(31).toString("base64") })).toThrow(
      "Invalid wrapping key configuration.",
    );
  });
});
