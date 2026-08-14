import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { expectAsyncResultError } from "../../../../test-utils/resultAssertions";
import { GoogleIdTokenVerifier } from "./googleIdTokenVerifier";
import { GoogleWrappingKeyDeriver } from "./googleWrappingKeyDeriver";
import { InMemoryGoogleWrappingKeyRateLimiter } from "./inMemoryGoogleWrappingKeyRateLimiter";
import type { VerifiedGoogleIdentity } from "./googleIdTokenVerification";
import {
  createConfiguredGoogleWrappingKeyRequest,
  GoogleWrappingKeyRequest,
} from "./googleWrappingKeyRequest";

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  subject: "google-subject",
};
describe("Google wrapping-key request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("verifies Google, rate limits, then derives wrapping material", async () => {
    const calls: string[] = [];
    const request = testRequest(
      async () => {
        calls.push("verify");
        return Result.ok(IDENTITY);
      },
      (limitedIdentity) => {
        calls.push(`rate-limit:${limitedIdentity.subject}`);
        return true;
      },
      (verifiedIdentity) => {
        calls.push(`derive:${verifiedIdentity.issuer}:${verifiedIdentity.subject}`);
        return "derived-wrapping-key";
      },
    );

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
    const request = testRequest(
      async () => Result.err({ code: "invalid_google_id_token" as const }),
      () => {
        rateLimitCalls += 1;
        return true;
      },
      () => {
        deriveCalls += 1;
        return "derived-wrapping-key";
      },
    );

    await expectAsyncResultError(
      request.requestGoogleWrappingKey("SECRET-GOOGLE-ID-TOKEN"),
      { code: "invalid_google_id_token" },
    );
    expect(rateLimitCalls).toBe(0);
    expect(deriveCalls).toBe(0);
  });

  it("rejects rate-limited identities", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const rateLimited = testRequest(
      async () => Result.ok(IDENTITY),
      () => false,
      () => "derived-wrapping-key",
    );

    await expectAsyncResultError(rateLimited.requestGoogleWrappingKey("id-token"), { code: "rate_limited" });
    expect(warning).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      layer: "server",
      operation: "rate_limit",
      code: "rate_limited",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(IDENTITY.subject);
  });

  it.each([
    ["verification", "verify"],
    ["rate limit", "rate_limit"],
    ["derivation", "derive"],
  ] as const)(
    "maps %s exceptions to dependency_unavailable",
    async (unavailableDependency, operation) => {
      const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
      const request = testRequest(
        async () => {
          if (unavailableDependency === "verification") throw new Error("SECRET-GOOGLE-ID-TOKEN");
          return Result.ok(IDENTITY);
        },
        () => {
          if (unavailableDependency === "rate limit") throw new Error("SECRET-GOOGLE-ID-TOKEN");
          return true;
        },
        () => {
          if (unavailableDependency === "derivation") throw new Error("SECRET-GOOGLE-ID-TOKEN");
          return "derived-wrapping-key";
        },
      );

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

  it("constructs the configured server flow", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", Buffer.alloc(32, 1).toString("base64"));

    expect(createConfiguredGoogleWrappingKeyRequest()).toBeInstanceOf(GoogleWrappingKeyRequest);
  });

  it.each(["not-base64!", "base64url_value"])("rejects invalid base64 server secret %s", (value) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", value);

    expect(() => createConfiguredGoogleWrappingKeyRequest()).toThrow();
  });

  it("rejects a server secret shorter than 32 decoded bytes", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", Buffer.alloc(31, 1).toString("base64"));

    expect(() => createConfiguredGoogleWrappingKeyRequest()).toThrow();
  });

  it("requires server secret configuration", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", undefined);

    expect(() => createConfiguredGoogleWrappingKeyRequest()).toThrow();
  });
});

function testRequest(
  verifyGoogleIdToken: GoogleIdTokenVerifier["verifyGoogleIdToken"],
  tryConsumeRequest: InMemoryGoogleWrappingKeyRateLimiter["tryConsumeRequest"],
  deriveWrappingKey: GoogleWrappingKeyDeriver["deriveWrappingKey"],
): GoogleWrappingKeyRequest {
  return new GoogleWrappingKeyRequest(
    new TestGoogleIdTokenVerifier(verifyGoogleIdToken),
    new TestGoogleWrappingKeyRateLimiter(tryConsumeRequest),
    new TestGoogleWrappingKeyDeriver(deriveWrappingKey),
  );
}

class TestGoogleIdTokenVerifier extends GoogleIdTokenVerifier {
  constructor(private verify: GoogleIdTokenVerifier["verifyGoogleIdToken"]) {
    super("test-client");
  }

  override verifyGoogleIdToken(idToken: string) {
    return this.verify(idToken);
  }
}

class TestGoogleWrappingKeyRateLimiter extends InMemoryGoogleWrappingKeyRateLimiter {
  constructor(private tryConsume: InMemoryGoogleWrappingKeyRateLimiter["tryConsumeRequest"]) {
    super(new Uint8Array(32));
  }

  override tryConsumeRequest(identity: VerifiedGoogleIdentity): boolean {
    return this.tryConsume(identity);
  }
}

class TestGoogleWrappingKeyDeriver extends GoogleWrappingKeyDeriver {
  constructor(private derive: GoogleWrappingKeyDeriver["deriveWrappingKey"]) {
    super(new Uint8Array(32));
  }

  override deriveWrappingKey(identity: VerifiedGoogleIdentity): string {
    return this.derive(identity);
  }
}
