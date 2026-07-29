import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../../../../../test-utils/resultAssertions";
import {
  GoogleIdTokenVerifier,
  type GoogleIdTokenVerificationResult,
} from "../adapters/googleIdTokenVerifier";
import { createRequestGoogleWrappingKey } from "./requestGoogleWrappingKey";

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};
describe("Google wrapping-key request", () => {
  it("verifies Google, rate limits, then derives wrapping material", async () => {
    const calls: string[] = [];
    const request = createRequestGoogleWrappingKey({
      googleIdTokenVerifier: testGoogleIdTokenVerifier(() => {
        calls.push("verify");
        return Result.ok(IDENTITY);
      }),
      checkRateLimit: async (limitedIdentity) => {
        calls.push(`rate-limit:${limitedIdentity.subject}`);
        return true;
      },
      deriveWrappingKey: (verifiedIdentity) => {
        calls.push(`derive:${verifiedIdentity.issuer}:${verifiedIdentity.subject}`);
        return "derived-wrapping-key";
      },
    });

    await expect(request("id-token")).resolves.toEqual(Result.ok("derived-wrapping-key"));
    expect(calls).toEqual([
      "verify",
      "rate-limit:google-subject",
      "derive:https://accounts.google.com:google-subject",
    ]);
  });

  it("does not rate limit or derive rejected tokens", async () => {
    let rateLimitCalls = 0;
    let deriveCalls = 0;
    const request = createRequestGoogleWrappingKey({
      googleIdTokenVerifier: testGoogleIdTokenVerifier(() =>
        Result.err({ code: "invalid_google_id_token" })
      ),
      checkRateLimit: async () => {
        rateLimitCalls += 1;
        return true;
      },
      deriveWrappingKey: () => {
        deriveCalls += 1;
        return "derived-wrapping-key";
      },
    });

    await expectAsyncResultError(
      request("id-token"),
      { code: "invalid_google_id_token" },
    );
    expect(rateLimitCalls).toBe(0);
    expect(deriveCalls).toBe(0);
  });

  it("rejects rate-limited identities", async () => {
    const rateLimited = createRequestGoogleWrappingKey({
      googleIdTokenVerifier: testGoogleIdTokenVerifier(() => Result.ok(IDENTITY)),
      checkRateLimit: async () => false,
      deriveWrappingKey: () => "derived-wrapping-key",
    });

    await expectAsyncResultError(rateLimited("id-token"), { code: "rate_limited" });
  });

  it.each(["verification", "rate limit", "derivation"] as const)(
    "maps %s exceptions to dependency_unavailable",
    async (unavailableDependency) => {
      const request = createRequestGoogleWrappingKey({
        googleIdTokenVerifier: testGoogleIdTokenVerifier(() => {
          if (unavailableDependency === "verification") throw new Error("unavailable");
          return Result.ok(IDENTITY);
        }),
        checkRateLimit: async () => {
          if (unavailableDependency === "rate limit") throw new Error("unavailable");
          return true;
        },
        deriveWrappingKey: () => {
          if (unavailableDependency === "derivation") throw new Error("unavailable");
          return "derived-wrapping-key";
        },
      });

      await expectAsyncResultError(request("id-token"), { code: "dependency_unavailable" });
    },
  );
});

function testGoogleIdTokenVerifier(
  implementation: () => GoogleIdTokenVerificationResult | Promise<GoogleIdTokenVerificationResult>,
): GoogleIdTokenVerifier {
  return new TestGoogleIdTokenVerifier(implementation);
}

class TestGoogleIdTokenVerifier extends GoogleIdTokenVerifier {
  readonly #implementation: () => GoogleIdTokenVerificationResult | Promise<GoogleIdTokenVerificationResult>;

  constructor(
    implementation: () => GoogleIdTokenVerificationResult | Promise<GoogleIdTokenVerificationResult>,
  ) {
    super({ audience: "google-client-id" });
    this.#implementation = implementation;
  }

  override async verifyGoogleIdToken(): Promise<GoogleIdTokenVerificationResult> {
    return this.#implementation();
  }
}
