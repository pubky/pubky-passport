import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import { getApplicationEnvironment } from "../../config/applicationEnvironment";
import {
  GoogleIdTokenVerifier,
  type GoogleIdTokenVerificationResult,
} from "./GoogleIdTokenVerifier";
import { GoogleWrappingKeyDeriver } from "./GoogleWrappingKeyDeriver";
import { InMemoryGoogleWrappingKeyRateLimiter } from "./InMemoryGoogleWrappingKeyRateLimiter";

export type GoogleWrappingKeyIssueErrorCode =
  | "invalid_google_id_token"
  | "rate_limited"
  | "dependency_unavailable";

export type GoogleWrappingKeyIssueResult = ResultType<
  string,
  CodedFailure<GoogleWrappingKeyIssueErrorCode>
>;

export class GoogleWrappingKeyIssuer {
  constructor(
    private googleIdTokenVerifier: GoogleIdTokenVerifier,
    private rateLimiter: InMemoryGoogleWrappingKeyRateLimiter,
    private deriver: GoogleWrappingKeyDeriver,
  ) {}

  static fromEnvironment(): GoogleWrappingKeyIssuer {
    const { googleClientId, serverSecret } = getApplicationEnvironment();
    const googleIdTokenVerifier = new GoogleIdTokenVerifier(googleClientId);
    const rateLimiter = new InMemoryGoogleWrappingKeyRateLimiter(serverSecret);
    const deriver = new GoogleWrappingKeyDeriver(serverSecret);
    return new GoogleWrappingKeyIssuer(googleIdTokenVerifier, rateLimiter, deriver);
  }

  async issueGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyIssueResult> {
    let identity: GoogleIdTokenVerificationResult;
    try {
      identity = await this.googleIdTokenVerifier.verifyGoogleIdToken(googleIdToken);
    } catch (cause) {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "verify",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable", cause });
    }

    if (Result.isError(identity)) {
      return Result.err(identity.error);
    }

    let allowed: boolean;
    try {
      allowed = this.rateLimiter.tryConsumeRequest(identity.value);
    } catch (cause) {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "rate_limit",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable", cause });
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
    } catch (cause) {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "derive",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable", cause });
    }
  }
}
