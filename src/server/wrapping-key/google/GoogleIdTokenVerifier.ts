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

export class GoogleIdTokenVerifier {
  constructor(
    private audience: string,
    private verifier: OAuth2Client = new OAuth2Client(),
    private now: () => Date = () => new Date(),
  ) {}

  async verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult> {
    let ticket: LoginTicket;
    try {
      ticket = await this.verifier.verifyIdToken({ idToken, audience: this.audience });
    } catch {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "google_verifier_rejected",
      });
      return failure();
    }

    let payload: GoogleIdTokenPayload | undefined;
    try {
      payload = ticket.getPayload();
    } catch {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "payload_access_failed",
      });
      return failure();
    }

    if (!payload) {
      LOGGER.warn("identity.google.id_token_verification.failed", {
        code: "missing_payload",
      });
      return failure();
    }

    const result = validatePayload(payload, this.audience, this.now());
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
  now: Date,
): GoogleIdTokenVerificationResult {
  if (!payload.iss || !ACCEPTED_GOOGLE_ISSUERS.has(payload.iss)) {
    return failure();
  }

  if (!audienceMatches(payload.aud, payload.azp, expectedAudience)) {
    return failure();
  }

  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new Error("Invalid Google ID token verifier clock.");
  }

  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  if (
    typeof payload.exp !== "number"
    || !Number.isFinite(payload.exp)
    || payload.exp <= nowSeconds
  ) {
    return failure();
  }

  if (!payload.sub?.trim()) {
    return failure();
  }

  return Result.ok({ issuer: CANONICAL_GOOGLE_ISSUER, subject: payload.sub });
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

function failure(): GoogleIdTokenVerificationResult {
  return Result.err({ code: "invalid_google_id_token" });
}
