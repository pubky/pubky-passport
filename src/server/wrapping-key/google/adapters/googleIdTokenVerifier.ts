import "server-only";

import { OAuth2Client } from "google-auth-library";
import { Result } from "better-result";

import {
  CANONICAL_GOOGLE_ISSUER,
  type GoogleIdTokenVerificationResult,
} from "../application/googleIdTokenVerification";

type GoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  azp?: string | undefined;
  exp?: number;
  sub?: string | undefined;
};

type GoogleLoginTicket = {
  getPayload(): GoogleIdTokenPayload | undefined;
};

type GoogleTokenVerifierDependency = {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<GoogleLoginTicket>;
};

const ACCEPTED_GOOGLE_ISSUERS = new Set(["accounts.google.com", CANONICAL_GOOGLE_ISSUER]);

export class GoogleIdTokenVerifier {
  readonly #audience: string;
  readonly #verifier: GoogleTokenVerifierDependency;
  readonly #now: () => Date;

  constructor(options: {
    audience: string;
    verifier?: GoogleTokenVerifierDependency;
    now?: () => Date;
  }) {
    this.#audience = options.audience;
    this.#verifier = options.verifier ?? new OAuth2Client();
    this.#now = options.now ?? (() => new Date());
  }

  async verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult> {
    let ticket: GoogleLoginTicket;
    try {
      ticket = await this.#verifier.verifyIdToken({ idToken, audience: this.#audience });
    } catch {
      return failure();
    }

    const payload = ticket.getPayload();
    if (!payload) {
      return failure();
    }

    return validatePayload(payload, this.#audience, this.#now());
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
