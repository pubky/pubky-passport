import { describe, expect, it } from "vitest";

import { createRequestWrappingKeyUseCase } from "./requestWrappingKey";
import type { Clock } from "../../ports/clock";
import type {
  GoogleIdTokenVerifier,
  GoogleIdTokenVerificationResult,
} from "../../ports/googleIdTokenVerifier";
import type { WrappingKeyDeriver } from "../../ports/wrappingKeyDeriver";
import type { WrappingKeyRateLimiter } from "../../ports/wrappingKeyRateLimiter";

const verifiedIdentity = {
  issuer: "https://accounts.google.com",
  subject: "google-subject",
  audience: "google-client-id",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
};

const fixedClock: Clock = {
  now() {
    return new Date("2026-01-01T00:00:00.000Z");
  },
};

describe("requestWrappingKey", () => {
  it("verifies the Google ID token before deriving a wrapping key", async () => {
    const calls: string[] = [];
    const useCase = createRequestWrappingKeyUseCase({
      googleIdTokenVerifier: verifier(() => {
        calls.push("verify");
        return { ok: true, identity: verifiedIdentity };
      }),
      wrappingKeyRateLimiter: rateLimiter(() => {
        calls.push("rate-limit");
        return { allowed: true };
      }),
      wrappingKeyDeriver: deriver(() => {
        calls.push("derive");
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expect(useCase({ googleIdToken: "id-token" })).resolves.toEqual({
      ok: true,
      wrappingKey: "derived-wrapping-key",
    });
    expect(calls).toEqual(["verify", "rate-limit", "derive"]);
  });

  it("rejects invalid token verification results without deriving", async () => {
    let deriveCalls = 0;
    const useCase = createRequestWrappingKeyUseCase({
      googleIdTokenVerifier: verifier(() => ({ ok: false, reason: "invalid" })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: deriver(() => {
        deriveCalls += 1;
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expect(useCase({ googleIdToken: "id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "invalid_google_id_token" },
    });
    expect(deriveCalls).toBe(0);
  });

  it("maps missing Google subjects without deriving", async () => {
    let deriveCalls = 0;
    const useCase = createRequestWrappingKeyUseCase({
      googleIdTokenVerifier: verifier(() => ({ ok: false, reason: "missing_subject" })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: deriver(() => {
        deriveCalls += 1;
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expect(useCase({ googleIdToken: "id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "missing_google_subject" },
    });
    expect(deriveCalls).toBe(0);
  });

  it("rejects rate-limited requests without deriving", async () => {
    let deriveCalls = 0;
    const useCase = createRequestWrappingKeyUseCase({
      googleIdTokenVerifier: verifier(() => ({ ok: true, identity: verifiedIdentity })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: false })),
      wrappingKeyDeriver: deriver(() => {
        deriveCalls += 1;
        return { wrappingKey: "derived-wrapping-key" };
      }),
      clock: fixedClock,
    });

    await expect(useCase({ googleIdToken: "id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "rate_limited" },
    });
    expect(deriveCalls).toBe(0);
  });

  it("maps dependency errors to safe results", async () => {
    const useCase = createRequestWrappingKeyUseCase({
      googleIdTokenVerifier: verifier(() => ({ ok: true, identity: verifiedIdentity })),
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: {
        async deriveWrappingKey() {
          throw new Error("derived secret must not leak");
        },
      },
      clock: fixedClock,
    });

    await expect(useCase({ googleIdToken: "id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
  });

  it("maps verifier dependency errors to safe results", async () => {
    const useCase = createRequestWrappingKeyUseCase({
      googleIdTokenVerifier: {
        async verifyIdToken() {
          throw new Error("id token must not leak");
        },
      },
      wrappingKeyRateLimiter: rateLimiter(() => ({ allowed: true })),
      wrappingKeyDeriver: deriver(() => ({ wrappingKey: "derived-wrapping-key" })),
      clock: fixedClock,
    });

    await expect(useCase({ googleIdToken: "id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
  });
});

function verifier(verify: () => GoogleIdTokenVerificationResult): GoogleIdTokenVerifier {
  return {
    async verifyIdToken() {
      return verify();
    },
  };
}

function rateLimiter(check: () => { allowed: true } | { allowed: false }): WrappingKeyRateLimiter {
  return {
    async checkWrappingKeyRequest() {
      return check();
    },
  };
}

function deriver(derive: () => { wrappingKey: string }): WrappingKeyDeriver {
  return {
    async deriveWrappingKey() {
      return derive();
    },
  };
}
