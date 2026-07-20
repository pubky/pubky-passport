import "server-only";

import "server-only";

import { createRequestWrappingKeyUseCase } from "../../core/application/identity/requestWrappingKey";
import { createRequestGoogleWrappingKeyController } from "../../core/controllers/identity/requestGoogleWrappingKeyController";
import type { ProviderIdTokenVerifier } from "../../core/ports/providerIdTokenVerifier";
import type { WrappingKeyDeriver } from "../../core/ports/wrappingKeyDeriver";
import type { WrappingKeyRateLimiter } from "../../core/ports/wrappingKeyRateLimiter";
import { systemClock } from "../server/systemClock";

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
