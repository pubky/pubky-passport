import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createGoogleNoncePreimage, googleNonceFor, isGoogleNoncePreimage } from "./googleNonce";

describe("Google nonce preimage", () => {
  it("is 32 random bytes in 43 canonical base64url characters", () => {
    const preimage = createGoogleNoncePreimage();
    expect(preimage).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(isGoogleNoncePreimage(preimage)).toBe(true);
    expect(createGoogleNoncePreimage()).not.toBe(preimage);
  });

  it("commits to the preimage as base64url(SHA-256(bytes)), as the server computes it", async () => {
    const preimage = createGoogleNoncePreimage();
    const expected = createHash("sha256")
      .update(Buffer.from(preimage, "base64url"))
      .digest("base64url");
    await expect(googleNonceFor(preimage)).resolves.toBe(expected);
    // Hashing the text instead of the bytes would give another nonce.
    expect(expected).not.toBe(createHash("sha256").update(preimage).digest("base64url"));
  });

  it.each([
    ["too short", "A".repeat(42)],
    ["too long", "A".repeat(44)],
    // 43 characters carry 258 bits: the last one must leave its 2 spare bits empty.
    ["non-canonical", `${"A".repeat(42)}B`],
    ["padded", `${"A".repeat(42)}=`],
    ["standard base64", `${"A".repeat(41)}+/`],
    ["not a string", 42],
  ])("refuses a %s value", async (_name, value) => {
    expect(isGoogleNoncePreimage(value)).toBe(false);
    if (typeof value === "string") await expect(googleNonceFor(value)).rejects.toThrow();
  });
});
