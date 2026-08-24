import "server-only";

import { OAuth2Client, type LoginTicket } from "google-auth-library";
import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import {
  CANONICAL_GOOGLE_ISSUER,
  type GoogleIdTokenVerificationResult,
} from "./googleIdTokenVerification";

type GoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  azp?: string | undefined;
  exp?: number;
  sub?: string | undefined;
};

const ACCEPTED_GOOGLE_ISSUERS = new Set(["accounts.google.com", CANONICAL_GOOGLE_ISSUER]);
type GoogleTokenVerifier = Pick<OAuth2Client, "verifyIdToken">;

export class GoogleIdTokenVerifier {
  static forAudience(audience: string): GoogleIdTokenVerifier {
    return new GoogleIdTokenVerifier(audience, new OAuth2Client());
  }

  constructor(
    private audience: string,
    private verifier: GoogleTokenVerifier,
  ) {}

  async verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult> {
    let ticket: LoginTicket;
    try {
      ticket = await this.verifier.verifyIdToken({ idToken, audience: this.audience });
    } catch (cause) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "google_verifier_rejected",
        thrownValue: cause instanceof Error ? "error" : "unknown",
      });
      return Result.err({ code: "invalid_google_id_token" });
    }

    let payload: GoogleIdTokenPayload | undefined;
    try {
      payload = ticket.getPayload();
    } catch (cause) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "payload_access_failed",
        thrownValue: cause instanceof Error ? "error" : "unknown",
      });
      return Result.err({ code: "invalid_google_id_token" });
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
  if (!payload.iss || !ACCEPTED_GOOGLE_ISSUERS.has(payload.iss)) {
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
