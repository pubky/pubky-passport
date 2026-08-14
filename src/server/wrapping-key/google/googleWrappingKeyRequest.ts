import "server-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { LOGGER } from "../../../libs/logger/logger";
import { getGoogleClientId } from "../../config/googleClientId";
import { GoogleIdTokenVerifier } from "./googleIdTokenVerifier";
import { GoogleWrappingKeyDeriver } from "./googleWrappingKeyDeriver";
import { InMemoryGoogleWrappingKeyRateLimiter } from "./inMemoryGoogleWrappingKeyRateLimiter";
import type { GoogleIdTokenVerificationResult } from "./googleIdTokenVerification";

const MINIMUM_SERVER_SECRET_BYTES = 32;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SERVER_SECRET_SCHEMA = z.string()
  .trim()
  .min(1, "PASSPORT_SERVER_SECRET_BASE64 is required")
  .regex(BASE64_PATTERN, "PASSPORT_SERVER_SECRET_BASE64 must be valid base64")
  .transform((value) => Buffer.from(value, "base64"))
  .refine(
    (value) => value.byteLength >= MINIMUM_SERVER_SECRET_BYTES,
    `PASSPORT_SERVER_SECRET_BASE64 must decode to at least ${MINIMUM_SERVER_SECRET_BYTES} bytes`,
  );

export type GoogleWrappingKeyRequestErrorCode =
  | "invalid_google_id_token"
  | "rate_limited"
  | "dependency_unavailable";

export type GoogleWrappingKeyRequestResult = ResultType<string, { code: GoogleWrappingKeyRequestErrorCode }>;

export class GoogleWrappingKeyRequest {
  private googleIdTokenVerifier: GoogleIdTokenVerifier;
  private rateLimiter: InMemoryGoogleWrappingKeyRateLimiter;
  private deriver: GoogleWrappingKeyDeriver;

  constructor(dependencies: {
    googleIdTokenVerifier: GoogleIdTokenVerifier;
    rateLimiter: InMemoryGoogleWrappingKeyRateLimiter;
    deriver: GoogleWrappingKeyDeriver;
  }) {
    this.googleIdTokenVerifier = dependencies.googleIdTokenVerifier;
    this.rateLimiter = dependencies.rateLimiter;
    this.deriver = dependencies.deriver;
  }

  async requestGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyRequestResult> {
    let identity: GoogleIdTokenVerificationResult;
    try {
      identity = await this.googleIdTokenVerifier.verifyGoogleIdToken(googleIdToken);
    } catch {
      return dependencyFailure("verify");
    }

    if (Result.isError(identity)) {
      return failure(identity.error.code);
    }

    let allowed: boolean;
    try {
      allowed = this.rateLimiter.tryConsumeRequest(identity.value);
    } catch {
      return dependencyFailure("rate_limit");
    }

    if (!allowed) {
      LOGGER.warn("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "rate_limit",
        code: "rate_limited",
      });
      return failure("rate_limited");
    }

    try {
      return Result.ok(this.deriver.deriveWrappingKey(identity.value));
    } catch {
      return dependencyFailure("derive");
    }
  }
}

export function createConfiguredGoogleWrappingKeyRequest(): GoogleWrappingKeyRequest {
  const serverSecret = SERVER_SECRET_SCHEMA.parse(process.env.PASSPORT_SERVER_SECRET_BASE64);

  try {
    return new GoogleWrappingKeyRequest({
      googleIdTokenVerifier: new GoogleIdTokenVerifier({ audience: getGoogleClientId() }),
      rateLimiter: new InMemoryGoogleWrappingKeyRateLimiter({ identityPepper: serverSecret }),
      deriver: new GoogleWrappingKeyDeriver(serverSecret),
    });
  } finally {
    serverSecret.fill(0);
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
