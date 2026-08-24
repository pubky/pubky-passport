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
    googleClientId: string,
    serverSecret: Uint8Array,
    private googleIdTokenVerifier: GoogleIdTokenVerifier = new GoogleIdTokenVerifier(googleClientId),
    private rateLimiter: InMemoryGoogleWrappingKeyRateLimiter = new InMemoryGoogleWrappingKeyRateLimiter(serverSecret),
    private deriver: GoogleWrappingKeyDeriver = new GoogleWrappingKeyDeriver(serverSecret),
  ) {}

  static fromEnvironment(): GoogleWrappingKeyIssuer {
    return new GoogleWrappingKeyIssuer(
      GOOGLE_CLIENT_ID_SCHEMA.parse(process.env.GOOGLE_CLIENT_ID),
      SERVER_SECRET_SCHEMA.parse(process.env.PASSPORT_SERVER_SECRET_BASE64),
    );
  }

  async issueGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyIssueResult> {
    let identity: GoogleIdTokenVerificationResult;
    try {
      identity = await this.googleIdTokenVerifier.verifyGoogleIdToken(googleIdToken);
    } catch {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "verify",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable" });
    }

    if (Result.isError(identity)) {
      return Result.err({ code: identity.error.code });
    }

    let allowed: boolean;
    try {
      allowed = this.rateLimiter.tryConsumeRequest(identity.value);
    } catch {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "rate_limit",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable" });
    }

    if (!allowed) {
      LOGGER.warn("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "rate_limit",
        code: "rate_limited",
      });
      return Result.err({ code: "rate_limited" });
    }

    try {
      return Result.ok(this.deriver.deriveWrappingKey(identity.value));
    } catch {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "derive",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable" });
    }
  }
}
