import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { expectAsyncResultError } from "../../../../../test-utils/resultAssertions";
import { GoogleWrappingKeyRequest } from "./googleWrappingKeyRequest";

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};
describe("Google wrapping-key request", () => {
  afterEach(() => vi.restoreAllMocks());

  it("verifies Google, rate limits, then derives wrapping material", async () => {
    const calls: string[] = [];
    const request = new GoogleWrappingKeyRequest({
      googleIdTokenVerifier: {
        async verifyGoogleIdToken() {
          calls.push("verify");
          return Result.ok(IDENTITY);
        },
      },
      rateLimiter: {
        checkRateLimit(limitedIdentity) {
          calls.push(`rate-limit:${limitedIdentity.subject}`);
          return true;
        },
      },
      deriver: {
        deriveWrappingKey(verifiedIdentity) {
          calls.push(`derive:${verifiedIdentity.issuer}:${verifiedIdentity.subject}`);
          return "derived-wrapping-key";
        },
      },
    });

    await expect(request.requestGoogleWrappingKey("id-token")).resolves.toEqual(Result.ok("derived-wrapping-key"));
    expect(calls).toEqual([
      "verify",
      "rate-limit:google-subject",
      "derive:https://accounts.google.com:google-subject",
    ]);
  });

  it("does not rate limit or derive rejected tokens", async () => {
    let rateLimitCalls = 0;
    let deriveCalls = 0;
    const request = new GoogleWrappingKeyRequest({
      googleIdTokenVerifier: {
        async verifyGoogleIdToken() {
          return Result.err({ code: "invalid_google_id_token" as const });
        },
      },
      rateLimiter: {
        checkRateLimit() {
          rateLimitCalls += 1;
          return true;
        },
      },
      deriver: {
        deriveWrappingKey() {
          deriveCalls += 1;
          return "derived-wrapping-key";
        },
      },
    });

    await expectAsyncResultError(
      request.requestGoogleWrappingKey("SECRET-GOOGLE-ID-TOKEN"),
      { code: "invalid_google_id_token" },
    );
    expect(rateLimitCalls).toBe(0);
    expect(deriveCalls).toBe(0);
  });

  it("rejects rate-limited identities", async () => {
    const rateLimited = new GoogleWrappingKeyRequest({
      googleIdTokenVerifier: { async verifyGoogleIdToken() { return Result.ok(IDENTITY); } },
      rateLimiter: { checkRateLimit() { return false; } },
      deriver: { deriveWrappingKey() { return "derived-wrapping-key"; } },
    });

    await expectAsyncResultError(rateLimited.requestGoogleWrappingKey("id-token"), { code: "rate_limited" });
  });

  it.each([
    ["verification", "verify"],
    ["rate limit", "rate_limit"],
    ["derivation", "derive"],
  ] as const)(
    "maps %s exceptions to dependency_unavailable",
    async (unavailableDependency, operation) => {
      const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
      const request = new GoogleWrappingKeyRequest({
        googleIdTokenVerifier: {
          async verifyGoogleIdToken() {
            if (unavailableDependency === "verification") throw new Error("SECRET-GOOGLE-ID-TOKEN");
            return Result.ok(IDENTITY);
          },
        },
        rateLimiter: {
          checkRateLimit() {
            if (unavailableDependency === "rate limit") throw new Error("SECRET-GOOGLE-ID-TOKEN");
            return true;
          },
        },
        deriver: {
          deriveWrappingKey() {
            if (unavailableDependency === "derivation") throw new Error("SECRET-GOOGLE-ID-TOKEN");
            return "derived-wrapping-key";
          },
        },
      });

      await expectAsyncResultError(
        request.requestGoogleWrappingKey("id-token"),
        { code: "dependency_unavailable" },
      );
      expect(error).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
        layer: "server",
        operation,
        code: "dependency_unavailable",
      });
      expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
    },
  );
});
