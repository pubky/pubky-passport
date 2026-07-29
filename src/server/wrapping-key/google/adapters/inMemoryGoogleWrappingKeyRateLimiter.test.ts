import { describe, expect, it } from "vitest";

import { InMemoryGoogleWrappingKeyRateLimiter } from "./inMemoryGoogleWrappingKeyRateLimiter";

const IDENTITY_PEPPER = Buffer.alloc(32, 7);
const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};

describe("wrapping-key rate limit", () => {
  it("limits verified identities within a rolling window", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      maximumRequests: 2,
      windowMilliseconds: 60_000,
      now: () => now,
    });

    expect(limiter.checkRateLimit(IDENTITY)).toBe(true);
    expect(limiter.checkRateLimit(IDENTITY)).toBe(true);
    expect(limiter.checkRateLimit(IDENTITY)).toBe(false);
  });

  it("retains an independent copy of the identity pepper", () => {
    const identityPepper = Buffer.from(IDENTITY_PEPPER);
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter({
      identityPepper,
      maximumRequests: 1,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(limiter.checkRateLimit(IDENTITY)).toBe(true);
    identityPepper.fill(0);
    expect(limiter.checkRateLimit(IDENTITY)).toBe(false);
  });

  it("limits identities independently and expires old requests", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      maximumRequests: 1,
      windowMilliseconds: 60_000,
      now: () => now,
    });

    expect(limiter.checkRateLimit(IDENTITY)).toBe(true);
    expect(limiter.checkRateLimit({ ...IDENTITY, subject: "other-google-subject" })).toBe(true);
    now = new Date("2026-01-01T00:01:00.000Z");
    expect(limiter.checkRateLimit(IDENTITY)).toBe(true);
  });

  it("prunes the active identity without waiting for a global sweep", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      maximumRequests: 1,
      windowMilliseconds: 60_000,
      now: () => now,
    });

    const otherIdentity = { ...IDENTITY, subject: "other-google-subject" };
    expect(limiter.checkRateLimit(otherIdentity)).toBe(true);
    now = new Date("2026-01-01T00:00:30.000Z");
    expect(limiter.checkRateLimit(IDENTITY)).toBe(true);
    now = new Date("2026-01-01T00:01:00.000Z");
    expect(limiter.checkRateLimit(otherIdentity)).toBe(true);
    now = new Date("2026-01-01T00:01:30.000Z");
    expect(limiter.checkRateLimit(IDENTITY)).toBe(true);
  });

  it.each([
    ["maximumRequests", 0],
    ["maximumRequests", Number.NaN],
    ["maximumRequests", Number.POSITIVE_INFINITY],
    ["maximumRequests", 1.5],
    ["windowMilliseconds", 0],
    ["windowMilliseconds", Number.NaN],
    ["windowMilliseconds", Number.POSITIVE_INFINITY],
    ["windowMilliseconds", 1.5],
  ] as const)("rejects invalid %s configuration", (property, value) => {
    expect(() => new InMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      [property]: value,
    })).toThrow("Invalid wrapping key rate limit configuration.");
  });

  it("rejects an invalid clock value", () => {
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter({
      identityPepper: IDENTITY_PEPPER,
      now: () => new Date(Number.NaN),
    });

    expect(() => limiter.checkRateLimit(IDENTITY)).toThrow("Invalid wrapping key rate limit request.");
  });
});
