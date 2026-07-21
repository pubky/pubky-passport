import "server-only";

import { createRequestWrappingKeyUseCase } from "../../core/identity/requestWrappingKey";
import { createRequestGoogleWrappingKeyController } from "../../core/identity/requestGoogleWrappingKeyController";
import type {
  ProviderIdTokenVerifier,
  WrappingKeyDeriver,
  WrappingKeyRateLimiter,
} from "../../core/identity/dependencies/wrappingKey";
import { systemClock } from "../../adapters/server/systemClock";

// Composition selects server implementations without adding flow rules or state.

const notConfiguredProviderIdTokenVerifier: ProviderIdTokenVerifier = {
  provider: "google",
  async verifyIdToken() {
    throw new Error("Provider ID token verifier is not configured.");
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

export function createWrappingKeyRequestController() {
  return createRequestGoogleWrappingKeyController(
    createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: notConfiguredProviderIdTokenVerifier,
      wrappingKeyDeriver: notConfiguredWrappingKeyDeriver,
      wrappingKeyRateLimiter: notConfiguredWrappingKeyRateLimiter,
      clock: systemClock,
    }),
  );
}
