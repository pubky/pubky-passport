import { describe, expect, it } from "vitest";

import { createInMemoryGoogleWrappingKeyRateLimiter } from "./googleWrappingKeyRateLimiter";

const serverSecretBase64 = Buffer.alloc(32, 7).toString("base64");
const identity = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};

describe("wrapping-key rate limit", () => {
  it("limits verified identities within a rolling window", async () => {
    const limiter = createInMemoryGoogleWrappingKeyRateLimiter({
      serverSecretBase64,
      maximumRequests: 2,
      windowMilliseconds: 60_000,
    });
    const at = new Date("2026-01-01T00:00:00.000Z");

    await expect(limiter.checkRequest({ identity, at })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkRequest({ identity, at })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkRequest({ identity, at })).resolves.toEqual({ allowed: false });
  });

  it("limits identities independently and expires old requests", async () => {
    const limiter = createInMemoryGoogleWrappingKeyRateLimiter({
      serverSecretBase64,
      maximumRequests: 1,
      windowMilliseconds: 60_000,
    });
    const firstRequest = new Date("2026-01-01T00:00:00.000Z");

    await expect(limiter.checkRequest({ identity, at: firstRequest })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkRequest({
      identity: { ...identity, subject: "other-google-subject" },
      at: firstRequest,
    })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkRequest({
      identity,
      at: new Date("2026-01-01T00:01:00.001Z"),
    })).resolves.toEqual({ allowed: true });
  });
});
