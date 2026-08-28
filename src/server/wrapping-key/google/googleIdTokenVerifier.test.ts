import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { OAuth2Client, type LoginTicket } from "google-auth-library";

import { expectAsyncResultError } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { GoogleIdTokenVerifier } from "./GoogleIdTokenVerifier";

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
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes accepted Google issuers to the canonical issuer", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), iss: "accounts.google.com" });

    await expect(verifier.verifyGoogleIdToken(TOKEN)).resolves.toEqual(
      Result.ok({
        issuer: "https://accounts.google.com",
        googleSubject: "google-subject",
      }),
    );
  });

  it("passes Passport's client ID to the Google verifier", async () => {
    const calls: Array<{ tokenPresent: boolean; audience: string }> = [];
    const verifier = new GoogleIdTokenVerifier(
      AUDIENCE,
      googleVerifier(async ({ idToken, audience: verifierAudience }) => {
        calls.push({
          tokenPresent: idToken.length > 0,
          audience: typeof verifierAudience === "string" ? verifierAudience : "",
        });
        return googleLoginTicketFixture(validPayload);
      }),
    );

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
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const verifier = createVerifierWithPayload(payload);

    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), {
      code: "invalid_google_id_token",
    });
    expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      operation: "validate_claims",
      code: "invalid_claims",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("google-subject");
  });

  it("requires the authorized party for multiple audiences", async () => {
    const verifier = new GoogleIdTokenVerifier(
      AUDIENCE,
      googleVerifier(
        vi
          .fn()
          .mockResolvedValueOnce(
            googleLoginTicketFixture(() => ({
              ...validPayload(),
              aud: ["other-client-id", AUDIENCE],
              azp: AUDIENCE,
            })),
          )
          .mockResolvedValueOnce(
            googleLoginTicketFixture(() => ({
              ...validPayload(),
              aud: ["other-client-id", AUDIENCE],
              azp: "other-client-id",
            })),
          ),
      ),
    );

    await expect(verifier.verifyGoogleIdToken(TOKEN)).resolves.toEqual(
      Result.ok({
        issuer: "https://accounts.google.com",
        googleSubject: "google-subject",
      }),
    );
    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), {
      code: "invalid_google_id_token",
    });
  });

  it.each(["expired", "audience recipient", "invalid"])(
    "maps verifier %s failures without logging the token",
    async (message) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const cause = new Error(`${message} token ${TOKEN}: {"sub":"google-subject"}`);
      const verifier = new GoogleIdTokenVerifier(
        AUDIENCE,
        googleVerifier(async () => {
          throw cause;
        }),
      );

      const result = await verifier.verifyGoogleIdToken(TOKEN);

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error).toEqual({ code: "invalid_google_id_token", cause });
        expect(result.error.cause).toBe(cause);
      }
      expect(warning).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
        code: "google_verifier_rejected",
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain(TOKEN);
      expect(JSON.stringify(warning.mock.calls)).not.toContain("google-subject");
    },
  );

  it("logs a safe failure when Google returns a ticket without a payload", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const verifier = new GoogleIdTokenVerifier(
      AUDIENCE,
      googleVerifier(async () => googleLoginTicketFixture(() => undefined)),
    );

    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), {
      code: "invalid_google_id_token",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      code: "missing_payload",
    });
  });

  it("maps payload access exceptions without logging their details", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new Error(`payload failed for ${TOKEN}`);
    const verifier = new GoogleIdTokenVerifier(
      AUDIENCE,
      googleVerifier(async () =>
        googleLoginTicketFixture(() => {
          throw cause;
        }),
      ),
    );

    const result = await verifier.verifyGoogleIdToken(TOKEN);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "invalid_google_id_token", cause });
      expect(result.error.cause).toBe(cause);
    }
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      code: "payload_access_failed",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(TOKEN);
  });
});

function createVerifierWithPayload(payload: TestGoogleIdTokenPayload) {
  return new GoogleIdTokenVerifier(
    AUDIENCE,
    googleVerifier(async () => googleLoginTicketFixture(() => payload)),
  );
}

function validPayload(): TestGoogleIdTokenPayload {
  return {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    exp: FUTURE_EXPIRATION,
    sub: "google-subject",
  };
}

function googleVerifier(
  verifyIdToken: OAuth2Client["verifyIdToken"],
): Pick<OAuth2Client, "verifyIdToken"> {
  return { verifyIdToken };
}

function googleLoginTicketFixture(
  getPayload: () => TestGoogleIdTokenPayload | undefined,
): LoginTicket {
  return { getPayload } as LoginTicket;
}
