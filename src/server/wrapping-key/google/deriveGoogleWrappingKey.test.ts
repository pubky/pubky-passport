import { describe, expect, it } from "vitest";

import { deriveGoogleWrappingKey } from "./deriveGoogleWrappingKey";

const SERVER_SECRET = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  googleSubject: "google-subject",
};

describe("Google wrapping-key derivation", () => {
  it("preserves the frozen Google HKDF fixture", () => {
    expect(deriveGoogleWrappingKey(SERVER_SECRET, IDENTITY)).toBe(
      "0Rvmd96LjmVRcQ7WjvQBSUKwlI1YHO_4xmqDELjAGOE",
    );
  });

  it("derives distinct material for distinct subjects", () => {
    const first = deriveGoogleWrappingKey(SERVER_SECRET, IDENTITY);
    const second = deriveGoogleWrappingKey(SERVER_SECRET, {
      ...IDENTITY,
      googleSubject: "other-google-subject",
    });

    expect(first).not.toBe(second);
  });

  it("rejects invalid verified identity input", () => {
    expect(() =>
      deriveGoogleWrappingKey(SERVER_SECRET, { ...IDENTITY, googleSubject: "" }),
    ).toThrow("Invalid wrapping key identity.");
  });
});
