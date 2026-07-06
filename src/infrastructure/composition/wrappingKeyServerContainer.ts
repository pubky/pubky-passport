import "server-only";

import { createRequestWrappingKeyUseCase } from "../../core/application/identity/requestWrappingKey";
import { createRequestWrappingKeyController } from "../../core/controllers/identity/requestWrappingKeyController";
import type { Clock } from "../../core/ports/clock";
import type { GoogleIdTokenVerifier } from "../../core/ports/googleIdTokenVerifier";
import type { WrappingKeyDeriver } from "../../core/ports/wrappingKeyDeriver";
import type { WrappingKeyRateLimiter } from "../../core/ports/wrappingKeyRateLimiter";

const notConfiguredGoogleIdTokenVerifier: GoogleIdTokenVerifier = {
  async verifyIdToken() {
    throw new Error("Google ID token verifier is not configured.");
  },
};

const notConfiguredWrappingKeyDeriver: WrappingKeyDeriver = {
  async deriveWrappingKey() {
    throw new Error("Wrapping key deriver is not configured.");
  },
};

const notConfiguredWrappingKeyRateLimiter: WrappingKeyRateLimiter = {
  async checkWrappingKeyRequest() {
    throw new Error("Wrapping key rate limiter is not configured.");
  },
};

const systemClock: Clock = {
  now() {
    return new Date();
  },
};

export function createWrappingKeyRequestController() {
  return createRequestWrappingKeyController(
    createRequestWrappingKeyUseCase({
      googleIdTokenVerifier: notConfiguredGoogleIdTokenVerifier,
      wrappingKeyDeriver: notConfiguredWrappingKeyDeriver,
      wrappingKeyRateLimiter: notConfiguredWrappingKeyRateLimiter,
      clock: systemClock,
    }),
  );
}
