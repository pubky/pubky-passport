import { describe, expect, it } from "vitest";

import { createInMemoryWrappingKeyRateLimiter } from "./inMemoryWrappingKeyRateLimiter";

const serverSecretBase64 = Buffer.alloc(32, 7).toString("base64");
const identity = {
  provider: "google" as const,
  issuer: "https://accounts.google.com",
  subject: "google-subject",
};

describe("InMemoryWrappingKeyRateLimiter", () => {
  it("limits verified identities within a rolling window", async () => {
    const limiter = createInMemoryWrappingKeyRateLimiter({
      serverSecretBase64,
      maximumRequests: 2,
      windowMilliseconds: 60_000,
    });
    const at = new Date("2026-01-01T00:00:00.000Z");

    await expect(limiter.checkWrappingKeyRequest({ ...identity, at })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkWrappingKeyRequest({ ...identity, at })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkWrappingKeyRequest({ ...identity, at })).resolves.toEqual({ allowed: false });
  });

  it("limits identities independently and expires old requests", async () => {
    const limiter = createInMemoryWrappingKeyRateLimiter({
      serverSecretBase64,
      maximumRequests: 1,
      windowMilliseconds: 60_000,
    });
    const firstRequest = new Date("2026-01-01T00:00:00.000Z");

    await expect(limiter.checkWrappingKeyRequest({ ...identity, at: firstRequest })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkWrappingKeyRequest({
      ...identity,
      subject: "other-google-subject",
      at: firstRequest,
    })).resolves.toEqual({ allowed: true });
    await expect(limiter.checkWrappingKeyRequest({
      ...identity,
      at: new Date("2026-01-01T00:01:00.001Z"),
    })).resolves.toEqual({ allowed: true });
  });

  it("rejects invalid rate-limit configuration", () => {
    expect(() => createInMemoryWrappingKeyRateLimiter({
      serverSecretBase64,
      maximumRequests: 0,
    })).toThrow("Invalid wrapping key rate limit configuration.");
  });
});
