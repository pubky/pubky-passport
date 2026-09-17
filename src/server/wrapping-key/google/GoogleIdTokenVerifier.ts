import "server-only";

import { OAuth2Client, type Certificates, type LoginTicket } from "google-auth-library";
import { Result } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";

export const CANONICAL_GOOGLE_ISSUER = "https://accounts.google.com";

export type VerifiedGoogleIdentity = {
  issuer: "https://accounts.google.com";
  googleSubject: string;
};

type GoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  azp?: string | undefined;
  exp?: number;
  sub?: string | undefined;
};

export type GoogleIdTokenVerificationResult = Result<
  VerifiedGoogleIdentity,
  CodedFailure<"google_verifier_unavailable" | "invalid_google_id_token">
>;

/** Verifies Google ID-token signatures, audience binding, expiry, issuer, and subject claims. */
export class GoogleIdTokenVerifier {
  private readonly verifier = new OAuth2Client();

  /** @param audience Google OAuth client ID that every accepted token must target. */
  constructor(private readonly audience: string) {}

  /**
   * Verifies the token and settles with a Result for verifier and claims failures.
   * The promise does not intentionally reject.
   */
  async verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult> {
    let certificates: Certificates;
    try {
      ({ certs: certificates } = await this.verifier.getFederatedSignonCertsAsync());
    } catch (e) {
      LOGGER.error("identity.google.id_token_verification.failed", {
        code: "google_verifier_unavailable",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "google_verifier_unavailable", cause: e });
    }

    let ticket: LoginTicket;
    try {
      ticket = await this.verifier.verifySignedJwtWithCertsAsync(
        idToken,
        certificates,
        this.audience,
        ["accounts.google.com", CANONICAL_GOOGLE_ISSUER],
      );
    } catch (e) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "google_verifier_rejected",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "invalid_google_id_token", cause: e });
    }

    let payload: GoogleIdTokenPayload | undefined;
    try {
      payload = ticket.getPayload();
    } catch (e) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "payload_access_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "invalid_google_id_token", cause: e });
    }

    if (!payload) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "missing_payload",
      });
      return Result.err({ code: "invalid_google_id_token" });
    }

    const result = this.validatePayload(payload);
    if (Result.isError(result)) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        operation: "validate_claims",
        code: "invalid_claims",
      });
    }
    return result;
  }

  private validatePayload(payload: GoogleIdTokenPayload): GoogleIdTokenVerificationResult {
    if (payload.iss !== "accounts.google.com" && payload.iss !== CANONICAL_GOOGLE_ISSUER) {
      return Result.err({ code: "invalid_google_id_token" });
    }

    if (!audienceMatches(payload.aud, payload.azp, this.audience)) {
      return Result.err({ code: "invalid_google_id_token" });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= nowSeconds
    ) {
      return Result.err({ code: "invalid_google_id_token" });
    }

    if (!payload.sub?.trim()) {
      return Result.err({ code: "invalid_google_id_token" });
    }

    return Result.ok(
      Object.freeze({
        issuer: CANONICAL_GOOGLE_ISSUER,
        googleSubject: payload.sub,
      }),
    );
  }
}

function audienceMatches(
  audience: string | string[] | undefined,
  authorizedParty: string | undefined,
  expectedAudience: string,
): boolean {
  if (Array.isArray(audience)) {
    return (
      audience.includes(expectedAudience) &&
      (audience.length === 1 || authorizedParty === expectedAudience)
    );
  }

  return audience === expectedAudience;
}
