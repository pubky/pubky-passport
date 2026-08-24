import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryGoogleWrappingKeyRateLimiter } from "./InMemoryGoogleWrappingKeyRateLimiter";

const IDENTITY_PEPPER = Buffer.alloc(32, 7);
const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  googleSubject: "google-subject",
};
const START_TIME = new Date("2026-01-01T00:00:00.000Z").getTime();

describe("wrapping-key rate limit", () => {
  let now: number;

  beforeEach(() => {
    now = START_TIME;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => vi.restoreAllMocks());

  it("limits verified identities within a rolling window", () => {
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter(IDENTITY_PEPPER);

    consumeMaximumRequests(limiter, IDENTITY);
    expect(limiter.tryConsumeRequest(IDENTITY)).toBe(false);
  });

  it("retains an independent copy of the identity pepper", () => {
    const identityPepper = Buffer.from(IDENTITY_PEPPER);
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter(identityPepper);

    expect(limiter.tryConsumeRequest(IDENTITY)).toBe(true);
    identityPepper.fill(0);
    for (let request = 1; request < 10; request += 1) {
      expect(limiter.tryConsumeRequest(IDENTITY)).toBe(true);
    }
    expect(limiter.tryConsumeRequest(IDENTITY)).toBe(false);
  });

  it("limits identities independently and expires old requests", () => {
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter(IDENTITY_PEPPER);
    const otherIdentity = { ...IDENTITY, googleSubject: "other-google-subject" };

    consumeMaximumRequests(limiter, IDENTITY);
    consumeMaximumRequests(limiter, otherIdentity);
    expect(limiter.tryConsumeRequest(IDENTITY)).toBe(false);
    expect(limiter.tryConsumeRequest(otherIdentity)).toBe(false);

    now += 60_000;
    expect(limiter.tryConsumeRequest(IDENTITY)).toBe(true);
  });

  it("prunes the active identity without waiting for a global sweep", () => {
    const limiter = new InMemoryGoogleWrappingKeyRateLimiter(IDENTITY_PEPPER);
    const otherIdentity = { ...IDENTITY, googleSubject: "other-google-subject" };
    consumeMaximumRequests(limiter, otherIdentity);
    now += 30_000;
    consumeMaximumRequests(limiter, IDENTITY);
    now += 30_000;
    expect(limiter.tryConsumeRequest(otherIdentity)).toBe(true);
    now += 30_000;
    expect(limiter.tryConsumeRequest(IDENTITY)).toBe(true);
  });
});

function consumeMaximumRequests(
  limiter: InMemoryGoogleWrappingKeyRateLimiter,
  identity: typeof IDENTITY,
): void {
  for (let request = 0; request < 10; request += 1) {
    expect(limiter.tryConsumeRequest(identity)).toBe(true);
  }
}
