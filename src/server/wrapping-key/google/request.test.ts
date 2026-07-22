import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../../../../test-utils/resultAssertions";
import { createGoogleWrappingKeyRequest } from "./request";
import type { GoogleIdTokenVerifier } from "./idTokenVerifier";
import type { GoogleWrappingKeyMaterial } from "./keyDeriver";
import type { GoogleWrappingKeyRateLimiter } from "./rateLimiter";

const identity = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};
const now = new Date("2026-01-01T00:00:00.000Z");

describe("Google wrapping-key request", () => {
  it("verifies Google, rate limits, then derives wrapping material", async () => {
    const calls: string[] = [];
    const request = createGoogleWrappingKeyRequest({
      googleIdTokenVerifier: verifier(() => {
        calls.push("verify");
        return Result.ok(identity);
      }),
      rateLimiter: rateLimiter(({ identity: limitedIdentity, at }) => {
        calls.push(`rate-limit:${limitedIdentity.subject}:${at.toISOString()}`);
        return { allowed: true };
      }),
      material: material((verifiedIdentity) => {
        calls.push(`derive:${verifiedIdentity.issuer}:${verifiedIdentity.subject}`);
        return { wrappingKey: "derived-wrapping-key" };
      }),
      now: () => now,
    });

    await expect(request.requestWrappingKey({ googleIdToken: "id-token" })).resolves.toEqual(Result.ok("derived-wrapping-key"));
    expect(calls).toEqual([
      "verify",
      "rate-limit:google-subject:2026-01-01T00:00:00.000Z",
      "derive:https://accounts.google.com:google-subject",
    ]);
  });

  it("does not rate limit or derive rejected tokens", async () => {
    let rateLimitCalls = 0;
    let deriveCalls = 0;
    const request = createGoogleWrappingKeyRequest({
      googleIdTokenVerifier: verifier(() => Result.err({ code: "invalid" })),
      rateLimiter: rateLimiter(() => {
        rateLimitCalls += 1;
        return { allowed: true };
      }),
      material: material(() => {
        deriveCalls += 1;
        return { wrappingKey: "derived-wrapping-key" };
      }),
    });

    await expectAsyncResultError(
      request.requestWrappingKey({ googleIdToken: "id-token" }),
      { code: "invalid_google_id_token" },
    );
    expect(rateLimitCalls).toBe(0);
    expect(deriveCalls).toBe(0);
  });

  it("rejects rate-limited and unavailable dependencies without leaking values", async () => {
    const rateLimited = createGoogleWrappingKeyRequest({
      googleIdTokenVerifier: verifier(() => Result.ok(identity)),
      rateLimiter: rateLimiter(() => ({ allowed: false })),
      material: material(() => ({ wrappingKey: "derived-wrapping-key" })),
    });
    const unavailable = createGoogleWrappingKeyRequest({
      googleIdTokenVerifier: {
        async verifyGoogleIdToken() {
          throw new Error("id-token must not leak");
        },
      },
      rateLimiter: rateLimiter(() => ({ allowed: true })),
      material: material(() => ({ wrappingKey: "derived-wrapping-key" })),
    });

    await expectAsyncResultError(rateLimited.requestWrappingKey({ googleIdToken: "id-token" }), { code: "rate_limited" });
    await expectAsyncResultError(
      unavailable.requestWrappingKey({ googleIdToken: "id-token" }),
      { code: "dependency_unavailable" },
    );
  });
});

function verifier(
  verify: () => Awaited<ReturnType<GoogleIdTokenVerifier["verifyGoogleIdToken"]>>,
): GoogleIdTokenVerifier {
  return { async verifyGoogleIdToken() { return verify(); } };
}

function rateLimiter(
  check: (input: { identity: { issuer: "https://accounts.google.com"; subject: string }; at: Date }) => { allowed: true } | { allowed: false },
): GoogleWrappingKeyRateLimiter {
  return { async checkRequest(input) { return check(input); } };
}

function material(
  derive: (verifiedIdentity: { issuer: "https://accounts.google.com"; subject: string }) => { wrappingKey: string },
): GoogleWrappingKeyMaterial {
  return { async deriveWrappingKey(verifiedIdentity) { return derive(verifiedIdentity); } };
}
