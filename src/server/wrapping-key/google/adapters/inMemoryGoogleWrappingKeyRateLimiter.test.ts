import { describe, expect, it } from "vitest";

import { createInMemoryGoogleWrappingKeyRateLimiter } from "./inMemoryGoogleWrappingKeyRateLimiter";

const IDENTITY_PEPPER = Buffer.alloc(32, 7);
const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};

describe("wrapping-key rate limit", () => {
  it("limits verified identities within a rolling window", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = createInMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      maximumRequests: 2,
      windowMilliseconds: 60_000,
      now: () => now,
    });

    await expect(limiter(IDENTITY)).resolves.toBe(true);
    await expect(limiter(IDENTITY)).resolves.toBe(true);
    await expect(limiter(IDENTITY)).resolves.toBe(false);
  });

  it("retains an independent copy of the identity pepper", async () => {
    const identityPepper = Buffer.from(IDENTITY_PEPPER);
    const limiter = createInMemoryGoogleWrappingKeyRateLimiter({
      identityPepper,
      maximumRequests: 1,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(limiter(IDENTITY)).resolves.toBe(true);
    identityPepper.fill(0);
    await expect(limiter(IDENTITY)).resolves.toBe(false);
  });

  it("limits identities independently and expires old requests", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = createInMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      maximumRequests: 1,
      windowMilliseconds: 60_000,
      now: () => now,
    });

    await expect(limiter(IDENTITY)).resolves.toBe(true);
    await expect(limiter({ ...IDENTITY, subject: "other-google-subject" })).resolves.toBe(true);
    now = new Date("2026-01-01T00:01:00.000Z");
    await expect(limiter(IDENTITY)).resolves.toBe(true);
  });

  it("prunes the active identity without waiting for a global sweep", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = createInMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      maximumRequests: 1,
      windowMilliseconds: 60_000,
      now: () => now,
    });

    const otherIdentity = { ...IDENTITY, subject: "other-google-subject" };
    await expect(limiter(otherIdentity)).resolves.toBe(true);
    now = new Date("2026-01-01T00:00:30.000Z");
    await expect(limiter(IDENTITY)).resolves.toBe(true);
    now = new Date("2026-01-01T00:01:00.000Z");
    await expect(limiter(otherIdentity)).resolves.toBe(true);
    now = new Date("2026-01-01T00:01:30.000Z");
    await expect(limiter(IDENTITY)).resolves.toBe(true);
  });
});
