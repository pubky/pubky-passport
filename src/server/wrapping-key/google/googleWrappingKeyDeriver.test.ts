import { describe, expect, it } from "vitest";

import { GoogleWrappingKeyDeriver } from "./googleWrappingKeyDeriver";

const SERVER_SECRET = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};

describe("Google wrapping-key derivation", () => {
  it("preserves the frozen Google HKDF fixture", () => {
    const serverSecret = Buffer.from(SERVER_SECRET);
    const deriver = new GoogleWrappingKeyDeriver(serverSecret);
    serverSecret.fill(0);

    expect(deriver.deriveWrappingKey(IDENTITY)).toBe("0Rvmd96LjmVRcQ7WjvQBSUKwlI1YHO_4xmqDELjAGOE");
  });

  it("derives distinct material for distinct subjects", () => {
    const deriver = new GoogleWrappingKeyDeriver(SERVER_SECRET);

    const first = deriver.deriveWrappingKey(IDENTITY);
    const second = deriver.deriveWrappingKey({ ...IDENTITY, subject: "other-google-subject" });

    expect(first).not.toBe(second);
  });

  it("rejects invalid verified identity input", () => {
    const deriver = new GoogleWrappingKeyDeriver(SERVER_SECRET);

    expect(() => deriver.deriveWrappingKey({ ...IDENTITY, subject: "" })).toThrow("Invalid wrapping key identity.");
  });
});
