import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { OAuth2Client, type LoginTicket } from "google-auth-library";

import { expectAsyncResultError } from "../../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../../libs/logger/logger";
import { GoogleIdTokenVerifier } from "./googleIdTokenVerifier";

const AUDIENCE = "google-client-id";
const TOKEN = "header.payload.signature";
const NOW = new Date("2026-01-01T00:00:00.000Z");
const FUTURE_EXPIRATION = Math.floor(new Date("2026-01-01T01:00:00.000Z").getTime() / 1000);

type TestGoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  sub?: string | undefined;
};

describe("Google ID token verifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes accepted Google issuers to the canonical issuer", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), iss: "accounts.google.com" });

    await expect(verifier.verifyGoogleIdToken(TOKEN)).resolves.toEqual(Result.ok({
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    }));
  });

  it("passes Passport's client ID to the Google verifier", async () => {
    const calls: Array<{ tokenPresent: boolean; audience: string }> = [];
    const verifier = new GoogleIdTokenVerifier({
      audience: AUDIENCE,
      now: () => NOW,
      verifier: fakeGoogleVerifier(({ idToken, audience: verifierAudience }) => {
        calls.push({ tokenPresent: idToken.length > 0, audience: verifierAudience });
        return validPayload();
      }),
    });

    await verifier.verifyGoogleIdToken(TOKEN);

    expect(calls).toEqual([{ tokenPresent: true, audience: AUDIENCE }]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it.each([
    { ...validPayload(), iss: "https://evil.example" },
    { ...validPayload(), aud: "other-client-id" },
    { ...validPayload(), exp: Math.floor(NOW.getTime() / 1000) },
    { ...validPayload(), exp: Number.NaN },
    { ...validPayload(), exp: Number.POSITIVE_INFINITY },
    { ...validPayload(), sub: undefined },
    { ...validPayload(), sub: "   " },
  ] as const)("rejects invalid claims", async (payload) => {
    const verifier = createVerifierWithPayload(payload);

    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), { code: "invalid_google_id_token" });
  });

  it("requires the authorized party for multiple audiences", async () => {
    const valid = createVerifierWithPayload({
      ...validPayload(),
      aud: ["other-client-id", AUDIENCE],
      azp: AUDIENCE,
    });
    const invalid = createVerifierWithPayload({
      ...validPayload(),
      aud: ["other-client-id", AUDIENCE],
      azp: "other-client-id",
    });

    await expect(valid.verifyGoogleIdToken(TOKEN)).resolves.toEqual(Result.ok({
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    }));
    await expectAsyncResultError(invalid.verifyGoogleIdToken(TOKEN), { code: "invalid_google_id_token" });
  });

  it.each(["expired", "audience recipient", "invalid"])(
    "maps verifier %s failures generically without exposing the token",
    async (message) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const verifier = new GoogleIdTokenVerifier({
        audience: AUDIENCE,
        now: () => NOW,
        verifier: googleVerifier(async () => {
            throw new Error(`${message} token ${TOKEN}`);
        }),
      });

      await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), { code: "invalid_google_id_token" });
      expect(warning).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
        code: "google_verifier_rejected",
      });
    },
  );

  it("logs a safe failure when Google returns a ticket without a payload", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const verifier = new GoogleIdTokenVerifier({
      audience: AUDIENCE,
      now: () => NOW,
      verifier: googleVerifier(async () => googleLoginTicketFixture(() => undefined)),
    });

    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), { code: "invalid_google_id_token" });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      code: "missing_payload",
    });
  });

  it("maps payload access exceptions without logging their details", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const verifier = new GoogleIdTokenVerifier({
      audience: AUDIENCE,
      now: () => NOW,
      verifier: googleVerifier(async () => googleLoginTicketFixture(() => {
        throw new Error(`payload failed for ${TOKEN}`);
      })),
    });

    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), { code: "invalid_google_id_token" });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      code: "payload_access_failed",
    });
  });

  it("rejects an invalid verification clock", async () => {
    const verifier = new GoogleIdTokenVerifier({
      audience: AUDIENCE,
      now: () => new Date(Number.NaN),
      verifier: fakeGoogleVerifier(() => validPayload()),
    });

    await expect(verifier.verifyGoogleIdToken(TOKEN)).rejects.toThrow("Invalid Google ID token verifier clock.");
  });
});

function createVerifierWithPayload(payload: TestGoogleIdTokenPayload) {
  return new GoogleIdTokenVerifier({
    audience: AUDIENCE,
    now: () => NOW,
    verifier: fakeGoogleVerifier(() => payload),
  });
}

function validPayload(): TestGoogleIdTokenPayload {
  return {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    exp: FUTURE_EXPIRATION,
    sub: "google-subject",
  };
}

function fakeGoogleVerifier(
  payload: (input: { idToken: string; audience: string }) => TestGoogleIdTokenPayload,
): OAuth2Client {
  return googleVerifier(async (input) => googleLoginTicketFixture(() => payload({
    idToken: input.idToken,
    audience: typeof input.audience === "string" ? input.audience : "",
  })));
}

function googleVerifier(
  verifyIdToken: OAuth2Client["verifyIdToken"],
): OAuth2Client {
  const verifier = new OAuth2Client();
  verifier.verifyIdToken = verifyIdToken;
  return verifier;
}

function googleLoginTicketFixture(getPayload: () => TestGoogleIdTokenPayload | undefined): LoginTicket {
  return { getPayload } as LoginTicket;
}
