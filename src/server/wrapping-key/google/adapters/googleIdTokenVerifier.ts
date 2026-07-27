import "server-only";

import { OAuth2Client } from "google-auth-library";
import { Result } from "better-result";

import {
  canonicalGoogleIssuer,
  type GoogleIdTokenVerificationErrorCode,
  type GoogleIdTokenVerificationResult,
  type GoogleIdTokenVerifier,
} from "../application/googleWrappingKey";

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

export type GoogleTokenVerifierDependency = {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<GoogleLoginTicket>;
};

export type CreateGoogleIdTokenVerifierInput = {
  audience: string;
  verifier?: GoogleTokenVerifierDependency;
  now?: () => Date;
};

const acceptedGoogleIssuers = new Set(["accounts.google.com", canonicalGoogleIssuer]);

export function createGoogleIdTokenVerifier(input: CreateGoogleIdTokenVerifierInput): GoogleIdTokenVerifier {
  const verifier = input.verifier ?? new OAuth2Client();
  const now = input.now ?? (() => new Date());

  return {
    async verifyGoogleIdToken(idToken) {
      let ticket: GoogleLoginTicket;
      try {
        ticket = await verifier.verifyIdToken({ idToken, audience: input.audience });
      } catch (error) {
        return failure(mapGoogleVerifierError(error));
      }

      const payload = ticket.getPayload();
      if (!payload) {
        return failure("invalid");
      }

      if (!payload.iss || !acceptedGoogleIssuers.has(payload.iss)) {
        return failure("unsupported_issuer");
      }

      if (!audienceMatches(payload.aud, payload.azp, input.audience)) {
        return failure("unsupported_audience");
      }

      if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now().getTime() / 1000)) {
        return failure("expired");
      }

      if (!payload.sub) {
        return failure("missing_subject");
      }

      return Result.ok({ issuer: canonicalGoogleIssuer, subject: payload.sub });
    },
  };
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
    return "expired";
  }

  if (message.includes("audience") || message.includes("recipient")) {
    return "unsupported_audience";
  }

  return "invalid";
}

function failure(code: GoogleIdTokenVerificationErrorCode): GoogleIdTokenVerificationResult {
  return Result.err({ code });
}
