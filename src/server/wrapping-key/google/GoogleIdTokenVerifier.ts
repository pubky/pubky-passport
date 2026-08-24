import "server-only";

import { OAuth2Client, type LoginTicket } from "google-auth-library";
import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";

export const CANONICAL_GOOGLE_ISSUER = "https://accounts.google.com";

export type VerifiedGoogleIdentity = {
  issuer: typeof CANONICAL_GOOGLE_ISSUER;
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
  CodedFailure<"invalid_google_id_token">
>;

export class GoogleIdTokenVerifier {
  constructor(
    private audience: string,
    private verifier: Pick<OAuth2Client, "verifyIdToken"> = new OAuth2Client(),
  ) {}

  async verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult> {
    let ticket: LoginTicket;
    try {
      ticket = await this.verifier.verifyIdToken({ idToken, audience: this.audience });
    } catch (cause) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "google_verifier_rejected",
      });
      return Result.err({ code: "invalid_google_id_token", cause });
    }

    let payload: GoogleIdTokenPayload | undefined;
    try {
      payload = ticket.getPayload();
    } catch (cause) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "payload_access_failed",
      });
      return Result.err({ code: "invalid_google_id_token", cause });
    }

    if (!payload) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "missing_payload",
      });
      return Result.err({ code: "invalid_google_id_token" });
    }

    const result = validatePayload(payload, this.audience);
    if (Result.isError(result)) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        operation: "validate_claims",
        code: "invalid_claims",
      });
    }
    return result;
  }
}

function validatePayload(
  payload: GoogleIdTokenPayload,
  expectedAudience: string,
): GoogleIdTokenVerificationResult {
  if (payload.iss !== "accounts.google.com" && payload.iss !== CANONICAL_GOOGLE_ISSUER) {
    return Result.err({ code: "invalid_google_id_token" });
  }

  if (!audienceMatches(payload.aud, payload.azp, expectedAudience)) {
    return Result.err({ code: "invalid_google_id_token" });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    typeof payload.exp !== "number"
    || !Number.isFinite(payload.exp)
    || payload.exp <= nowSeconds
  ) {
    return Result.err({ code: "invalid_google_id_token" });
  }

  if (!payload.sub?.trim()) {
    return Result.err({ code: "invalid_google_id_token" });
  }

  return Result.ok({ issuer: CANONICAL_GOOGLE_ISSUER, googleSubject: payload.sub });
}

function audienceMatches(
  audience: string | string[] | undefined,
  authorizedParty: string | undefined,
  expectedAudience: string,
): boolean {
  if (Array.isArray(audience)) {
    return audience.includes(expectedAudience) && (audience.length === 1 || authorizedParty === expectedAudience);
  }

  return audience === expectedAudience;
}
