import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { OAuth2Client, type LoginTicket } from "google-auth-library";

import { expectAsyncResultError } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { GoogleIdTokenVerifier } from "./GoogleIdTokenVerifier";

const AUDIENCE = "google-client-id";
const TOKEN = "header.payload.signature";
const NOW = new Date("2026-01-01T00:00:00.000Z");
const FUTURE_EXPIRATION = Math.floor(new Date("2026-01-01T01:00:00.000Z").getTime() / 1000);
const CERTIFICATES = { "key-id": "certificate" };
const CERTIFICATE_RESPONSE = {
  certs: CERTIFICATES,
  format: "PEM",
} as Awaited<ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>>;

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
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue(
      CERTIFICATE_RESPONSE,
    );
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
    const calls: Array<{ tokenPresent: boolean; audience: string; issuers: string[] }> = [];
    vi.spyOn(OAuth2Client.prototype, "verifySignedJwtWithCertsAsync").mockImplementation(
      async (idToken, certificates, verifierAudience, issuers) => {
        calls.push({
          tokenPresent: idToken.length > 0,
          audience: typeof verifierAudience === "string" ? verifierAudience : "",
          issuers: issuers ?? [],
        });
        expect(certificates).toBe(CERTIFICATES);
        return googleLoginTicketFixture(validPayload);
      },
    );
    const verifier = new GoogleIdTokenVerifier(AUDIENCE);

    await verifier.verifyGoogleIdToken(TOKEN);

    expect(calls).toEqual([
      {
        tokenPresent: true,
        audience: AUDIENCE,
        issuers: ["accounts.google.com", "https://accounts.google.com"],
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it("maps signing-certificate fetch failures to verifier unavailability", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const cause = new Error(`certificate fetch failed for ${TOKEN}`);
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockRejectedValueOnce(cause);
    const verifier = new GoogleIdTokenVerifier(AUDIENCE);

    const result = await verifier.verifyGoogleIdToken(TOKEN);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "google_verifier_unavailable", cause });
    }
    expect(error).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      code: "google_verifier_unavailable",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
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
    vi.spyOn(OAuth2Client.prototype, "verifySignedJwtWithCertsAsync")
      .mockImplementationOnce(async () =>
        googleLoginTicketFixture(() => ({
          ...validPayload(),
          aud: ["other-client-id", AUDIENCE],
          azp: AUDIENCE,
        })),
      )
      .mockImplementationOnce(async () =>
        googleLoginTicketFixture(() => ({
          ...validPayload(),
          aud: ["other-client-id", AUDIENCE],
          azp: "other-client-id",
        })),
      );
    const verifier = new GoogleIdTokenVerifier(AUDIENCE);

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
      vi.spyOn(OAuth2Client.prototype, "verifySignedJwtWithCertsAsync").mockImplementation(
        async () => {
          throw cause;
        },
      );
      const verifier = new GoogleIdTokenVerifier(AUDIENCE);

      const result = await verifier.verifyGoogleIdToken(TOKEN);

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error).toEqual({ code: "invalid_google_id_token", cause });
        expect(result.error.cause).toBe(cause);
      }
      expect(warning).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
        code: "google_verifier_rejected",
        diagnosticId: expect.any(String),
        errorName: "Error",
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain(TOKEN);
      expect(JSON.stringify(warning.mock.calls)).not.toContain("google-subject");
    },
  );

  it("logs a safe failure when Google returns a ticket without a payload", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(OAuth2Client.prototype, "verifySignedJwtWithCertsAsync").mockImplementation(async () =>
      googleLoginTicketFixture(() => undefined),
    );
    const verifier = new GoogleIdTokenVerifier(AUDIENCE);

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
    vi.spyOn(OAuth2Client.prototype, "verifySignedJwtWithCertsAsync").mockImplementation(async () =>
      googleLoginTicketFixture(() => {
        throw cause;
      }),
    );
    const verifier = new GoogleIdTokenVerifier(AUDIENCE);

    const result = await verifier.verifyGoogleIdToken(TOKEN);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "invalid_google_id_token", cause });
      expect(result.error.cause).toBe(cause);
    }
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      code: "payload_access_failed",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(TOKEN);
  });
});

function createVerifierWithPayload(payload: TestGoogleIdTokenPayload) {
  vi.spyOn(OAuth2Client.prototype, "verifySignedJwtWithCertsAsync").mockImplementation(async () =>
    googleLoginTicketFixture(() => payload),
  );
  return new GoogleIdTokenVerifier(AUDIENCE);
}

function validPayload(): TestGoogleIdTokenPayload {
  return {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    exp: FUTURE_EXPIRATION,
    sub: "google-subject",
  };
}

function googleLoginTicketFixture(
  getPayload: () => TestGoogleIdTokenPayload | undefined,
): LoginTicket {
  return { getPayload } as LoginTicket;
}
