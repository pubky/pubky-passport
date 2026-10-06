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
  iat?: number;
  nonce?: string | undefined;
  sub?: string | undefined;
};

/**
 * How old an accepted token may be. Defense in depth only (the nonce's preimage is the binding):
 * a sign-in may pause at Google Drive consent, and a same-tab one may take five minutes.
 */
export const ID_TOKEN_MAX_AGE_SECONDS = 10 * 60;
/** Clock difference allowed between Google and this server, in both directions. */
export const ID_TOKEN_CLOCK_SKEW_SECONDS = 60;

export type GoogleIdTokenVerificationResult = Result<
  VerifiedGoogleIdentity,
  CodedFailure<"google_verifier_unavailable" | "invalid_google_id_token">
>;

/**
 * Verifies Google ID-token signatures, audience and authorized party, issuer, expiry, issue time,
 * the nonce Passport asked Google for, and the subject claim.
 */
export class GoogleIdTokenVerifier {
  private readonly verifier = new OAuth2Client();

  /** @param audience Google OAuth client ID that every accepted token must target. */
  constructor(private readonly audience: string) {}

  /**
   * Verifies the token and settles with a Result for verifier and claims failures.
   * The promise does not intentionally reject.
   *
   * @param expectedNonce The `nonce` the token must carry: the hash of the preimage that only
   * Passport's own client holds (see `googleNonceFor`).
   */
  async verifyGoogleIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<GoogleIdTokenVerificationResult> {
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

    const result = this.validatePayload(payload, expectedNonce);
    if (Result.isError(result)) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        operation: "validate_claims",
        code: "invalid_claims",
      });
    }
    return result;
  }

  private validatePayload(
    payload: GoogleIdTokenPayload,
    expectedNonce: string,
  ): GoogleIdTokenVerificationResult {
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

    // Issued for Passport's own request: Homegate receives the same token, never the preimage.
    if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
      return Result.err({ code: "invalid_google_id_token" });
    }

    if (
      typeof payload.iat !== "number" ||
      !Number.isFinite(payload.iat) ||
      payload.iat > nowSeconds + ID_TOKEN_CLOCK_SKEW_SECONDS ||
      payload.iat < nowSeconds - ID_TOKEN_MAX_AGE_SECONDS - ID_TOKEN_CLOCK_SKEW_SECONDS
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
  // A token issued to another client names that client; Google sets it to Passport's own ID.
  if (authorizedParty !== undefined && authorizedParty !== expectedAudience) return false;
  if (Array.isArray(audience)) {
    return (
      audience.includes(expectedAudience) &&
      (audience.length === 1 || authorizedParty === expectedAudience)
    );
  }

  return audience === expectedAudience;
}
