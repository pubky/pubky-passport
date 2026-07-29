import "server-only";

import { OAuth2Client } from "google-auth-library";
import { Result, type Result as ResultType } from "better-result";

export const CANONICAL_GOOGLE_ISSUER = "https://accounts.google.com";

export type VerifiedGoogleIdentity = {
  issuer: typeof CANONICAL_GOOGLE_ISSUER;
  subject: string;
};

export type GoogleIdTokenVerificationErrorCode =
  | "invalid_google_id_token"
  | "expired_google_id_token"
  | "unsupported_google_issuer"
  | "unsupported_google_audience"
  | "missing_google_subject";

export type GoogleIdTokenVerificationResult = ResultType<
  VerifiedGoogleIdentity,
  { code: GoogleIdTokenVerificationErrorCode }
>;

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
    } catch (error) {
      return failure(mapGoogleVerifierError(error));
    }

    const payload = ticket.getPayload();
    if (!payload) {
      return failure("invalid_google_id_token");
    }

    if (!payload.iss || !ACCEPTED_GOOGLE_ISSUERS.has(payload.iss)) {
      return failure("unsupported_google_issuer");
    }

    if (!audienceMatches(payload.aud, payload.azp, this.#audience)) {
      return failure("unsupported_google_audience");
    }

    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(this.#now().getTime() / 1000)) {
      return failure("expired_google_id_token");
    }

    if (!payload.sub) {
      return failure("missing_google_subject");
    }

    return Result.ok({ issuer: CANONICAL_GOOGLE_ISSUER, subject: payload.sub });
  }
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

function mapGoogleVerifierError(error: unknown): GoogleIdTokenVerificationErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("expired")) {
    return "expired_google_id_token";
  }

  if (message.includes("audience") || message.includes("recipient")) {
    return "unsupported_google_audience";
  }

  return "invalid_google_id_token";
}

function failure(code: GoogleIdTokenVerificationErrorCode): GoogleIdTokenVerificationResult {
  return Result.err({ code });
}
