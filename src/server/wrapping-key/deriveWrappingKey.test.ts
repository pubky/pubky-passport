import { describe, expect, it } from "vitest";

import { deriveWrappingKey } from "./deriveWrappingKey";

const SERVER_SECRET = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);

const GOOGLE_IDENTITY = {
  provider: "google" as const,
  issuer: "https://accounts.google.com",
  subject: "google-subject",
};

describe("wrapping-key derivation", () => {
  it("preserves the frozen Google HKDF fixture", () => {
    expect(deriveWrappingKey(SERVER_SECRET, GOOGLE_IDENTITY)).toBe(
      "0Rvmd96LjmVRcQ7WjvQBSUKwlI1YHO_4xmqDELjAGOE",
    );
  });

  it("derives distinct material for distinct subjects", () => {
    const first = deriveWrappingKey(SERVER_SECRET, GOOGLE_IDENTITY);
    const second = deriveWrappingKey(SERVER_SECRET, {
      ...GOOGLE_IDENTITY,
      subject: "other-google-subject",
    });

    expect(first).not.toBe(second);
  });

  it("rejects invalid verified identity input", () => {
    expect(() => deriveWrappingKey(SERVER_SECRET, { ...GOOGLE_IDENTITY, subject: "" })).toThrow(
      "Invalid wrapping key identity.",
    );
    expect(() => deriveWrappingKey(SERVER_SECRET, { ...GOOGLE_IDENTITY, issuer: " " })).toThrow(
      "Invalid wrapping key identity.",
    );
  });
});
