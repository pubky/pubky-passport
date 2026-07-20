import "server-only";

import { OAuth2Client } from "google-auth-library";

import type { Clock } from "../../../../core/ports/clock";
import type {
  ProviderIdTokenVerificationFailureReason,
  ProviderIdTokenVerificationResult,
  ProviderIdTokenVerifier,
} from "../../../../core/ports/providerIdTokenVerifier";
import { systemClock } from "../../systemClock";

type GoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  azp?: string | undefined;
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

export class ServerGoogleIdTokenVerifier implements ProviderIdTokenVerifier {
  readonly provider = "google";

  private readonly audience: string;
  private readonly verifier: GoogleTokenVerifierDependency;
  private readonly clock: Clock;

  constructor(options: ServerGoogleIdTokenVerifierOptions) {
    this.audience = options.audience;
    this.verifier = options.verifier;
    this.clock = options.clock;
  }

  async verifyIdToken(idToken: string): Promise<ProviderIdTokenVerificationResult> {
    let ticket: GoogleLoginTicket;

    try {
      ticket = await this.verifier.verifyIdToken({ idToken, audience: this.audience });
    } catch (error) {
      return { ok: false, reason: mapGoogleVerifierError(error) };
    }

    const payload = ticket.getPayload();
    if (!payload) {
      return { ok: false, reason: "invalid" };
    }

    const validatedPayload = validatePayload(payload, this.audience, this.clock.now());
    if (!validatedPayload.ok) {
      return { ok: false, reason: validatedPayload.reason };
    }

    return {
      ok: true,
      identity: {
        provider: "google",
        issuer: validatedPayload.payload.iss,
        subject: validatedPayload.payload.sub,
      },
    };
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
):
  | { ok: true; payload: ValidGoogleIdTokenPayload }
  | { ok: false; reason: ProviderIdTokenVerificationFailureReason } {
  if (!payload.iss || !acceptedIssuers.has(payload.iss)) {
    return { ok: false, reason: "unsupported_issuer" };
  }

  if (!audienceMatches(payload.aud, payload.azp, expectedAudience)) {
    return { ok: false, reason: "unsupported_audience" };
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now.getTime() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  if (!payload.sub) {
    return { ok: false, reason: "missing_subject" };
  }

  return { ok: true, payload: { iss: payload.iss, exp: payload.exp, sub: payload.sub } };
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

function mapGoogleVerifierError(error: unknown): ProviderIdTokenVerificationFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("expired")) {
    return "expired";
  }

  if (message.includes("audience") || message.includes("recipient")) {
    return "unsupported_audience";
  }

  return "invalid";
}
