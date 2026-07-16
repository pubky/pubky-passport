import "server-only";

import { OAuth2Client } from "google-auth-library";
import { Result, type Result as ResultType } from "better-result";

import type { Clock } from "../../../core/ports/clock";
import type {
  GoogleIdTokenVerificationFailureReason,
  GoogleIdTokenVerificationResult,
  GoogleIdTokenVerifier,
} from "../../../core/ports/googleIdTokenVerifier";
import { systemClock } from "../systemClock";

type GoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
};

type ValidGoogleIdTokenPayload = {
  iss: string;
  exp: number;
  sub: string;
};

type GoogleLoginTicket = {
  getPayload(): GoogleIdTokenPayload | undefined;
};

export type GoogleTokenVerifierDependency = {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<GoogleLoginTicket>;
};

export type ServerGoogleIdTokenVerifierOptions = {
  audience: string;
  verifier: GoogleTokenVerifierDependency;
  clock: Clock;
};

const acceptedIssuers = new Set(["accounts.google.com", "https://accounts.google.com"]);

export class ServerGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  private readonly audience: string;
  private readonly verifier: GoogleTokenVerifierDependency;
  private readonly clock: Clock;

  constructor(options: ServerGoogleIdTokenVerifierOptions) {
    this.audience = options.audience;
    this.verifier = options.verifier;
    this.clock = options.clock;
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult> {
    let ticket: GoogleLoginTicket;

    try {
      ticket = await this.verifier.verifyIdToken({ idToken, audience: this.audience });
    } catch (error) {
      return Result.err(mapGoogleVerifierError(error));
    }

    const payload = ticket.getPayload();
    if (!payload) {
      return Result.err("invalid");
    }

    const validatedPayload = validatePayload(payload, this.audience, this.clock.now());
    if (Result.isError(validatedPayload)) {
      return Result.err(validatedPayload.error);
    }

    return Result.ok({
        issuer: validatedPayload.value.iss,
        subject: validatedPayload.value.sub,
        audience: this.audience,
        expiresAt: new Date(validatedPayload.value.exp * 1000),
    });
  }
}

export function createGoogleAuthLibraryIdTokenVerifier(input: {
  audience: string;
  clock?: Clock;
}): ServerGoogleIdTokenVerifier {
  return new ServerGoogleIdTokenVerifier({
    audience: input.audience,
    verifier: new OAuth2Client(),
    clock: input.clock ?? systemClock,
  });
}

function validatePayload(
  payload: GoogleIdTokenPayload,
  expectedAudience: string,
  now: Date,
): ResultType<ValidGoogleIdTokenPayload, GoogleIdTokenVerificationFailureReason> {
  if (!payload.iss || !acceptedIssuers.has(payload.iss)) {
    return Result.err("unsupported_issuer");
  }

  if (!audienceMatches(payload.aud, expectedAudience)) {
    return Result.err("unsupported_audience");
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now.getTime() / 1000)) {
    return Result.err("expired");
  }

  if (!payload.sub) {
    return Result.err("missing_subject");
  }

  return Result.ok({ iss: payload.iss, exp: payload.exp, sub: payload.sub });
}

function audienceMatches(audience: string | string[] | undefined, expectedAudience: string): boolean {
  if (Array.isArray(audience)) {
    return audience.includes(expectedAudience);
  }

  return audience === expectedAudience;
}

function mapGoogleVerifierError(error: unknown): GoogleIdTokenVerificationFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("expired")) {
    return "expired";
  }

  if (message.includes("audience") || message.includes("recipient")) {
    return "unsupported_audience";
  }

  return "invalid";
}
