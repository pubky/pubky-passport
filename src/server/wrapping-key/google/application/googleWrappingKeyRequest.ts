import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import {
  type GoogleIdTokenVerificationErrorCode,
  type GoogleIdTokenVerificationResult,
  type GoogleIdTokenVerifier,
} from "../adapters/googleIdTokenVerifier";
import type { GoogleWrappingKeyDeriver } from "../adapters/googleWrappingKeyDeriver";
import type { InMemoryGoogleWrappingKeyRateLimiter } from "../adapters/inMemoryGoogleWrappingKeyRateLimiter";

export type GoogleWrappingKeyRequestErrorCode =
  | GoogleIdTokenVerificationErrorCode
  | "rate_limited"
  | "dependency_unavailable";

export type GoogleWrappingKeyRequestResult = ResultType<string, { code: GoogleWrappingKeyRequestErrorCode }>;

export class GoogleWrappingKeyRequest {
  readonly #googleIdTokenVerifier: Pick<GoogleIdTokenVerifier, "verifyGoogleIdToken">;
  readonly #rateLimiter: Pick<InMemoryGoogleWrappingKeyRateLimiter, "checkRateLimit">;
  readonly #deriver: Pick<GoogleWrappingKeyDeriver, "deriveWrappingKey">;

  constructor(dependencies: {
    googleIdTokenVerifier: Pick<GoogleIdTokenVerifier, "verifyGoogleIdToken">;
    rateLimiter: Pick<InMemoryGoogleWrappingKeyRateLimiter, "checkRateLimit">;
    deriver: Pick<GoogleWrappingKeyDeriver, "deriveWrappingKey">;
  }) {
    this.#googleIdTokenVerifier = dependencies.googleIdTokenVerifier;
    this.#rateLimiter = dependencies.rateLimiter;
    this.#deriver = dependencies.deriver;
  }

  async requestGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyRequestResult> {
    let identity: GoogleIdTokenVerificationResult;
    try {
      identity = await this.#googleIdTokenVerifier.verifyGoogleIdToken(googleIdToken);
    } catch {
      return dependencyFailure("verify");
    }

    if (Result.isError(identity)) {
      return failure(identity.error.code);
    }

    let allowed: boolean;
    try {
      allowed = this.#rateLimiter.checkRateLimit(identity.value);
    } catch {
      return dependencyFailure("rate_limit");
    }

    if (!allowed) return failure("rate_limited");

    try {
      return Result.ok(this.#deriver.deriveWrappingKey(identity.value));
    } catch {
      return dependencyFailure("derive");
    }
  }
}

function failure(code: GoogleWrappingKeyRequestErrorCode): GoogleWrappingKeyRequestResult {
  return Result.err({ code });
}

function dependencyFailure(operation: "verify" | "rate_limit" | "derive"): GoogleWrappingKeyRequestResult {
  LOGGER.error("identity.google.wrapping_key.failed", {
    layer: "server",
    operation,
    code: "dependency_unavailable",
  });
  return failure("dependency_unavailable");
}
