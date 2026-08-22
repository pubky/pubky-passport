import "server-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { LOGGER } from "../../../libs/logger/logger";
import { GoogleIdTokenVerifier } from "./GoogleIdTokenVerifier";
import { GoogleWrappingKeyDeriver } from "./GoogleWrappingKeyDeriver";
import { InMemoryGoogleWrappingKeyRateLimiter } from "./InMemoryGoogleWrappingKeyRateLimiter";
import type { GoogleIdTokenVerificationResult } from "./googleIdTokenVerification";

const MINIMUM_SERVER_SECRET_BYTES = 32;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const GOOGLE_CLIENT_ID_SCHEMA = z.string().trim().min(1, "GOOGLE_CLIENT_ID is required");
const SERVER_SECRET_SCHEMA = z.string()
  .trim()
  .min(1, "PASSPORT_SERVER_SECRET_BASE64 is required")
  .regex(BASE64_PATTERN, "PASSPORT_SERVER_SECRET_BASE64 must be valid base64")
  .transform((value) => Buffer.from(value, "base64"))
  .refine(
    (value) => value.byteLength >= MINIMUM_SERVER_SECRET_BYTES,
    `PASSPORT_SERVER_SECRET_BASE64 must decode to at least ${MINIMUM_SERVER_SECRET_BYTES} bytes`,
  );

export type GoogleWrappingKeyIssueErrorCode =
  | "invalid_google_id_token"
  | "rate_limited"
  | "dependency_unavailable";

export type GoogleWrappingKeyIssueResult = ResultType<string, { code: GoogleWrappingKeyIssueErrorCode }>;

export class GoogleWrappingKeyIssuer {
  constructor(
    private googleIdTokenVerifier: GoogleIdTokenVerifier,
    private rateLimiter: InMemoryGoogleWrappingKeyRateLimiter,
    private deriver: GoogleWrappingKeyDeriver,
  ) {}

  async issueGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyIssueResult> {
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

export function createConfiguredGoogleWrappingKeyIssuer(): GoogleWrappingKeyIssuer {
  const googleClientId = GOOGLE_CLIENT_ID_SCHEMA.parse(process.env.GOOGLE_CLIENT_ID);
  const serverSecret = SERVER_SECRET_SCHEMA.parse(process.env.PASSPORT_SERVER_SECRET_BASE64);

  try {
    return new GoogleWrappingKeyIssuer(
      new GoogleIdTokenVerifier(googleClientId),
      new InMemoryGoogleWrappingKeyRateLimiter(serverSecret),
      new GoogleWrappingKeyDeriver(serverSecret),
    );
  } finally {
    serverSecret.fill(0);
  }
}

function failure(code: GoogleWrappingKeyIssueErrorCode): GoogleWrappingKeyIssueResult {
  return Result.err({ code });
}

function dependencyFailure(operation: "verify" | "rate_limit" | "derive"): GoogleWrappingKeyIssueResult {
  LOGGER.error("identity.google.wrapping_key.failed", {
    layer: "server",
    operation,
    code: "dependency_unavailable",
  });
  return failure("dependency_unavailable");
}
