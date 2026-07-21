import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../../../test-utils/resultAssertions";
import {
  createRequestWrappingKeyUseCase,
  type RequestWrappingKeyResult,
} from "./requestWrappingKey";
import type {
  Clock,
  ProviderIdTokenVerificationResult,
  ProviderIdTokenVerifier,
  WrappingKeyDeriver,
  WrappingKeyRateLimiter,
} from "./wrappingKeyDependencies";

const verifiedIdentity = {
  provider: "google" as const,
  issuer: "https://accounts.google.com",
  subject: "google-subject",
};

const fixedClock: Clock = {
  now() {
    return new Date("2026-01-01T00:00:00.000Z");
  },
};

async function expectError(result: Promise<RequestWrappingKeyResult>, code: string): Promise<void> {
  await expectAsyncResultError(result, { code });
}

describe("requestWrappingKey", () => {
  it("verifies the provider ID token before deriving a wrapping key", async () => {
    const calls: string[] = [];
    let rateLimitInput: unknown;
    const useCase = createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: verifier(() => {
        calls.push("verify");
        return { ok: true, identity: verifiedIdentity };
      }),
      wrappingKeyRateLimiter: rateLimiter(input => {
        rateLimitInput = input;
        calls.push("rate-limit");
        return { allowed: true };
      }),
      wrappingKeyDeriver: deriver(input => {
        calls.push(`${input.provider}:${input.issuer}:${input.subject}`);
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expect(useCase({ provider: "google", idToken: "id-token" })).resolves.toEqual(Result.ok("derived-wrapping-key"));
    expect(calls).toEqual(["verify", "rate-limit", "google:https://accounts.google.com:google-subject"]);
    expect(rateLimitInput).toEqual({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "google-subject",
      at: fixedClock.now(),
    });
  });

  it("rejects invalid token verification results without deriving", async () => {
    let deriveCalls = 0;
    const useCase = createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: verifier(() => ({ ok: false, reason: "invalid" })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: deriver(() => {
        deriveCalls += 1;
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expectError(useCase({ provider: "google", idToken: "id-token" }), "invalid_id_token");
    expect(deriveCalls).toBe(0);
  });

  it("maps missing provider subjects without deriving", async () => {
    let deriveCalls = 0;
    const useCase = createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: verifier(() => ({ ok: false, reason: "missing_subject" })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: deriver(() => {
        deriveCalls += 1;
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expectError(useCase({ provider: "google", idToken: "id-token" }), "missing_subject");
    expect(deriveCalls).toBe(0);
  });

  it("rejects rate-limited requests without deriving", async () => {
    let deriveCalls = 0;
    const useCase = createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: verifier(() => ({ ok: true, identity: verifiedIdentity })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: false })),
      wrappingKeyDeriver: deriver(() => {
        deriveCalls += 1;
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expectError(useCase({ provider: "google", idToken: "id-token" }), "rate_limited");
    expect(deriveCalls).toBe(0);
  });

  it("maps dependency errors to safe results", async () => {
    const useCase = createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: verifier(() => ({ ok: true, identity: verifiedIdentity })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: {
        async deriveWrappingKey() {
          throw new Error("derived secret must not leak");
        },
      },
      clock: fixedClock,
    });

    await expectError(useCase({ provider: "google", idToken: "id-token" }), "dependency_unavailable");
  });

  it("maps verifier dependency errors to safe results", async () => {
    const useCase = createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: {
        provider: "google",
        async verifyIdToken() {
          throw new Error("id token must not leak");
        },
      },
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: deriver(() => ({ wrappingKey: "derived-wrapping-key" })),
      clock: fixedClock,
    });

    await expectError(useCase({ provider: "google", idToken: "id-token" }), "dependency_unavailable");
  });
});

function verifier(verify: () => ProviderIdTokenVerificationResult): ProviderIdTokenVerifier {
  return {
    provider: "google",
    async verifyIdToken() {
      return verify();
    },
  };
}

function rateLimiter(
  check: (input: { provider: "google"; issuer: string; subject: string; at: Date }) => { allowed: true } | { allowed: false },
): WrappingKeyRateLimiter {
  return {
    async checkWrappingKeyRequest(input) {
      return check(input);
    },
  };
}

function deriver(
  derive: (input: { provider: "google"; issuer: string; subject: string }) => { wrappingKey: string },
): WrappingKeyDeriver {
  return {
    async deriveWrappingKey(input) {
      return derive(input);
    },
  };
}
