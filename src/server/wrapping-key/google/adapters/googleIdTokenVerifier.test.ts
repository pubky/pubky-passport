import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../../../../../test-utils/resultAssertions";
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
  it("normalizes accepted Google issuers to the canonical issuer", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), iss: "accounts.google.com" });

    await expect(verifier.verifyGoogleIdToken(TOKEN)).resolves.toEqual(Result.ok({
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    }));
  });

  it("passes Passport's client ID to the Google verifier", async () => {
    const calls: Array<{ idToken: string; audience: string }> = [];
    const verifier = new GoogleIdTokenVerifier({
      audience: AUDIENCE,
      now: () => NOW,
      verifier: fakeGoogleVerifier(({ idToken, audience: verifierAudience }) => {
        calls.push({ idToken, audience: verifierAudience });
        return validPayload();
      }),
    });

    await verifier.verifyGoogleIdToken(TOKEN);

    expect(calls).toEqual([{ idToken: TOKEN, audience: AUDIENCE }]);
  });

  it.each([
    [{ ...validPayload(), iss: "https://evil.example" }, "unsupported_google_issuer"],
    [{ ...validPayload(), aud: "other-client-id" }, "unsupported_google_audience"],
    [{ ...validPayload(), exp: Math.floor(NOW.getTime() / 1000) }, "expired_google_id_token"],
    [{ ...validPayload(), sub: undefined }, "missing_google_subject"],
  ] as const)("rejects invalid claims", async (payload, code) => {
    const verifier = createVerifierWithPayload(payload);

    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), { code });
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
    await expectAsyncResultError(invalid.verifyGoogleIdToken(TOKEN), { code: "unsupported_google_audience" });
  });

  it("maps verifier failures without exposing the token", async () => {
    const verifier = new GoogleIdTokenVerifier({
      audience: AUDIENCE,
      now: () => NOW,
      verifier: {
        async verifyIdToken() {
          throw new Error(`invalid token ${TOKEN}`);
        },
      },
    });

    await expectAsyncResultError(verifier.verifyGoogleIdToken(TOKEN), { code: "invalid_google_id_token" });
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
) {
  return {
    async verifyIdToken(input: { idToken: string; audience: string }) {
      return { getPayload: () => payload(input) };
    },
  };
}
