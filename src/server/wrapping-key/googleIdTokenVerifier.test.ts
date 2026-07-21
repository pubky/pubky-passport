import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../../../test-utils/resultAssertions";
import {
  createGoogleIdTokenVerifier,
  type GoogleTokenVerifierDependency,
} from "./googleIdTokenVerifier";

const audience = "google-client-id";
const token = "header.payload.signature";
const now = new Date("2026-01-01T00:00:00.000Z");
const futureExpiration = Math.floor(new Date("2026-01-01T01:00:00.000Z").getTime() / 1000);

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

    await expect(verifier.verifyGoogleIdToken(token)).resolves.toEqual(Result.ok({
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    }));
  });

  it("passes Passport's client ID to the Google verifier", async () => {
    const calls: Array<{ idToken: string; audience: string }> = [];
    const verifier = createGoogleIdTokenVerifier({
      audience,
      now: () => now,
      verifier: fakeGoogleVerifier(({ idToken, audience: verifierAudience }) => {
        calls.push({ idToken, audience: verifierAudience });
        return validPayload();
      }),
    });

    await verifier.verifyGoogleIdToken(token);

    expect(calls).toEqual([{ idToken: token, audience }]);
  });

  it.each([
    [{ ...validPayload(), iss: "https://evil.example" }, "unsupported_issuer"],
    [{ ...validPayload(), aud: "other-client-id" }, "unsupported_audience"],
    [{ ...validPayload(), exp: Math.floor(now.getTime() / 1000) }, "expired"],
    [{ ...validPayload(), sub: undefined }, "missing_subject"],
  ] as const)("rejects invalid claims", async (payload, code) => {
    const verifier = createVerifierWithPayload(payload);

    await expectAsyncResultError(verifier.verifyGoogleIdToken(token), { code });
  });

  it("requires the authorized party for multiple audiences", async () => {
    const valid = createVerifierWithPayload({
      ...validPayload(),
      aud: ["other-client-id", audience],
      azp: audience,
    });
    const invalid = createVerifierWithPayload({
      ...validPayload(),
      aud: ["other-client-id", audience],
      azp: "other-client-id",
    });

    await expect(valid.verifyGoogleIdToken(token)).resolves.toEqual(Result.ok({
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    }));
    await expectAsyncResultError(invalid.verifyGoogleIdToken(token), { code: "unsupported_audience" });
  });

  it("maps verifier failures without exposing the token", async () => {
    const verifier = createGoogleIdTokenVerifier({
      audience,
      now: () => now,
      verifier: {
        async verifyIdToken() {
          throw new Error(`invalid token ${token}`);
        },
      },
    });

    await expectAsyncResultError(verifier.verifyGoogleIdToken(token), { code: "invalid" });
  });
});

function createVerifierWithPayload(payload: TestGoogleIdTokenPayload) {
  return createGoogleIdTokenVerifier({
    audience,
    now: () => now,
    verifier: fakeGoogleVerifier(() => payload),
  });
}

function validPayload(): TestGoogleIdTokenPayload {
  return {
    iss: "https://accounts.google.com",
    aud: audience,
    exp: futureExpiration,
    sub: "google-subject",
  };
}

function fakeGoogleVerifier(
  payload: (input: { idToken: string; audience: string }) => TestGoogleIdTokenPayload,
): GoogleTokenVerifierDependency {
  return {
    async verifyIdToken(input) {
      return { getPayload: () => payload(input) };
    },
  };
}
