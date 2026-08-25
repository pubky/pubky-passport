import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { expectAsyncResultError, expectResultError } from "../../../../test-utils/resultAssertions";
import { GoogleIdTokenVerifier } from "./GoogleIdTokenVerifier";
import { GoogleWrappingKeyDeriver } from "./GoogleWrappingKeyDeriver";
import { InMemoryGoogleWrappingKeyRateLimiter } from "./InMemoryGoogleWrappingKeyRateLimiter";
import { GoogleWrappingKeyIssuer } from "./GoogleWrappingKeyIssuer";

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  googleSubject: "google-subject",
};
describe("Google wrapping-key issuer", () => {
  beforeEach(() => {
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("verifies Google, rate limits, then derives wrapping material", async () => {
    const calls: string[] = [];
    const issuer = testIssuer(
      async () => {
        calls.push("verify");
        return Result.ok(IDENTITY);
      },
      (limitedIdentity) => {
        calls.push(`rate-limit:${limitedIdentity.googleSubject}`);
        return true;
      },
      (verifiedIdentity) => {
        calls.push(`derive:${verifiedIdentity.issuer}:${verifiedIdentity.googleSubject}`);
        return "derived-wrapping-key";
      },
    );

    await expect(issuer.issueGoogleWrappingKey("id-token")).resolves.toEqual(Result.ok("derived-wrapping-key"));
    expect(calls).toEqual([
      "verify",
      "rate-limit:google-subject",
      "derive:https://accounts.google.com:google-subject",
    ]);
  });

  it("does not rate limit or derive rejected tokens", async () => {
    let rateLimitCalls = 0;
    let deriveCalls = 0;
    const issuer = testIssuer(
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
      issuer.issueGoogleWrappingKey("SECRET-GOOGLE-ID-TOKEN"),
      { code: "invalid_google_id_token" },
    );
    expect(rateLimitCalls).toBe(0);
    expect(deriveCalls).toBe(0);
  });

  it("passes verifier failure causes through unchanged", async () => {
    const cause = new Error("SECRET-GOOGLE-ID-TOKEN");
    const verificationFailure = { code: "invalid_google_id_token" as const, cause };
    const issuer = testIssuer(
      async () => Result.err(verificationFailure),
      () => true,
      () => "derived-wrapping-key",
    );

    const result = await issuer.issueGoogleWrappingKey("id-token");

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toBe(verificationFailure);
      expect(result.error.cause).toBe(cause);
    }
  });

  it("rejects rate-limited identities", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const rateLimited = testIssuer(
      async () => Result.ok(IDENTITY),
      () => false,
      () => "derived-wrapping-key",
    );

    await expectAsyncResultError(rateLimited.issueGoogleWrappingKey("id-token"), { code: "rate_limited" });
    expect(warning).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      layer: "server",
      operation: "rate_limit",
      code: "rate_limited",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(IDENTITY.googleSubject);
  });

  it.each([
    ["verification", "verify"],
    ["rate limit", "rate_limit"],
    ["derivation", "derive"],
  ] as const)(
    "maps %s exceptions to dependency_unavailable",
    async (unavailableDependency, operation) => {
      const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
      const cause = new Error("SECRET-GOOGLE-ID-TOKEN");
      const issuer = testIssuer(
        async () => {
          if (unavailableDependency === "verification") throw cause;
          return Result.ok(IDENTITY);
        },
        () => {
          if (unavailableDependency === "rate limit") throw cause;
          return true;
        },
        () => {
          if (unavailableDependency === "derivation") throw cause;
          return "derived-wrapping-key";
        },
      );

      const result = await issuer.issueGoogleWrappingKey("id-token");

      expectResultError(result, { code: "dependency_unavailable", cause });
      if (Result.isError(result)) expect(result.error.cause).toBe(cause);
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

    expect(GoogleWrappingKeyIssuer.fromEnvironment()).toBeInstanceOf(GoogleWrappingKeyIssuer);
  });

  it.each(["not-base64!", "base64url_value"])("rejects invalid base64 server secret %s", (value) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", value);

    expect(() => GoogleWrappingKeyIssuer.fromEnvironment()).toThrow();
  });

  it("rejects a server secret shorter than 32 decoded bytes", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", Buffer.alloc(31, 1).toString("base64"));

    expect(() => GoogleWrappingKeyIssuer.fromEnvironment()).toThrow();
  });

  it("requires server secret configuration", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", undefined);

    expect(() => GoogleWrappingKeyIssuer.fromEnvironment()).toThrow();
  });
});

function testIssuer(
  verifyGoogleIdToken: GoogleIdTokenVerifier["verifyGoogleIdToken"],
  tryConsumeRequest: InMemoryGoogleWrappingKeyRateLimiter["tryConsumeRequest"],
  deriveWrappingKey: GoogleWrappingKeyDeriver["deriveWrappingKey"],
): GoogleWrappingKeyIssuer {
  const secret = Buffer.alloc(32, 1);
  const verifier = new GoogleIdTokenVerifier("google-client-id");
  const rateLimiter = new InMemoryGoogleWrappingKeyRateLimiter(secret);
  const deriver = new GoogleWrappingKeyDeriver(secret);
  vi.spyOn(verifier, "verifyGoogleIdToken").mockImplementation(verifyGoogleIdToken);
  vi.spyOn(rateLimiter, "tryConsumeRequest").mockImplementation(tryConsumeRequest);
  vi.spyOn(deriver, "deriveWrappingKey").mockImplementation(deriveWrappingKey);
  return new GoogleWrappingKeyIssuer(verifier, rateLimiter, deriver);
}
