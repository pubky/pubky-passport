import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { expectAsyncResultError } from "../../../../../test-utils/resultAssertions";
import { GoogleIdTokenVerifier } from "../adapters/googleIdTokenVerifier";
import { GoogleWrappingKeyDeriver } from "../adapters/googleWrappingKeyDeriver";
import { InMemoryGoogleWrappingKeyRateLimiter } from "../adapters/inMemoryGoogleWrappingKeyRateLimiter";
import type { VerifiedGoogleIdentity } from "./googleIdTokenVerification";
import { GoogleWrappingKeyRequest } from "./googleWrappingKeyRequest";

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};
describe("Google wrapping-key request", () => {
  afterEach(() => vi.restoreAllMocks());

  it("verifies Google, rate limits, then derives wrapping material", async () => {
    const calls: string[] = [];
    const request = new GoogleWrappingKeyRequest(testDependencies({
        async verifyGoogleIdToken() {
          calls.push("verify");
          return Result.ok(IDENTITY);
        },
        tryConsumeRequest(limitedIdentity) {
          calls.push(`rate-limit:${limitedIdentity.subject}`);
          return true;
        },
        deriveWrappingKey(verifiedIdentity) {
          calls.push(`derive:${verifiedIdentity.issuer}:${verifiedIdentity.subject}`);
          return "derived-wrapping-key";
        },
    }));

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
    const request = new GoogleWrappingKeyRequest(testDependencies({
        async verifyGoogleIdToken() {
          return Result.err({ code: "invalid_google_id_token" as const });
        },
        tryConsumeRequest() {
          rateLimitCalls += 1;
          return true;
        },
        deriveWrappingKey() {
          deriveCalls += 1;
          return "derived-wrapping-key";
        },
    }));

    await expectAsyncResultError(
      request.requestGoogleWrappingKey("SECRET-GOOGLE-ID-TOKEN"),
      { code: "invalid_google_id_token" },
    );
    expect(rateLimitCalls).toBe(0);
    expect(deriveCalls).toBe(0);
  });

  it("rejects rate-limited identities", async () => {
    const rateLimited = new GoogleWrappingKeyRequest(testDependencies({
      async verifyGoogleIdToken() { return Result.ok(IDENTITY); },
      tryConsumeRequest() { return false; },
      deriveWrappingKey() { return "derived-wrapping-key"; },
    }));

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
      const request = new GoogleWrappingKeyRequest(testDependencies({
          async verifyGoogleIdToken() {
            if (unavailableDependency === "verification") throw new Error("SECRET-GOOGLE-ID-TOKEN");
            return Result.ok(IDENTITY);
          },
          tryConsumeRequest() {
            if (unavailableDependency === "rate limit") throw new Error("SECRET-GOOGLE-ID-TOKEN");
            return true;
          },
          deriveWrappingKey() {
            if (unavailableDependency === "derivation") throw new Error("SECRET-GOOGLE-ID-TOKEN");
            return "derived-wrapping-key";
          },
      }));

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

function testDependencies(input: {
  verifyGoogleIdToken: GoogleIdTokenVerifier["verifyGoogleIdToken"];
  tryConsumeRequest: InMemoryGoogleWrappingKeyRateLimiter["tryConsumeRequest"];
  deriveWrappingKey: GoogleWrappingKeyDeriver["deriveWrappingKey"];
}): ConstructorParameters<typeof GoogleWrappingKeyRequest>[0] {
  return {
    googleIdTokenVerifier: new TestGoogleIdTokenVerifier(input.verifyGoogleIdToken),
    rateLimiter: new TestGoogleWrappingKeyRateLimiter(input.tryConsumeRequest),
    deriver: new TestGoogleWrappingKeyDeriver(input.deriveWrappingKey),
  };
}

class TestGoogleIdTokenVerifier extends GoogleIdTokenVerifier {
  readonly #verify: GoogleIdTokenVerifier["verifyGoogleIdToken"];

  constructor(verify: GoogleIdTokenVerifier["verifyGoogleIdToken"]) {
    super({ audience: "test-client" });
    this.#verify = verify;
  }

  override verifyGoogleIdToken(idToken: string) {
    return this.#verify(idToken);
  }
}

class TestGoogleWrappingKeyRateLimiter extends InMemoryGoogleWrappingKeyRateLimiter {
  readonly #tryConsume: InMemoryGoogleWrappingKeyRateLimiter["tryConsumeRequest"];

  constructor(tryConsume: InMemoryGoogleWrappingKeyRateLimiter["tryConsumeRequest"]) {
    super({ identityPepper: new Uint8Array(32) });
    this.#tryConsume = tryConsume;
  }

  override tryConsumeRequest(identity: VerifiedGoogleIdentity): boolean {
    return this.#tryConsume(identity);
  }
}

class TestGoogleWrappingKeyDeriver extends GoogleWrappingKeyDeriver {
  readonly #derive: GoogleWrappingKeyDeriver["deriveWrappingKey"];

  constructor(derive: GoogleWrappingKeyDeriver["deriveWrappingKey"]) {
    super(new Uint8Array(32));
    this.#derive = derive;
  }

  override deriveWrappingKey(identity: VerifiedGoogleIdentity): string {
    return this.#derive(identity);
  }
}
