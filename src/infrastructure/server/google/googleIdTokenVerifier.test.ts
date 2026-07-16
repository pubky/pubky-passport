import { describe, expect, it } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import {
  ServerGoogleIdTokenVerifier,
  type GoogleTokenVerifierDependency,
} from "./googleIdTokenVerifier";
import type { Clock } from "../../../core/ports/clock";

const audience = "google-client-id";
const token = "header.payload.signature";
const now = new Date("2026-01-01T00:00:00.000Z");
const futureExpiration = Math.floor(new Date("2026-01-01T01:00:00.000Z").getTime() / 1000);
const pastExpiration = Math.floor(new Date("2025-12-31T23:00:00.000Z").getTime() / 1000);

const fixedClock: Clock = {
  now() {
    return now;
  },
};

function expectError(result: ResultType<unknown, string>, reason: string): void {
  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toBe(reason);
  }
}

async function expectAsyncError(result: Promise<ResultType<unknown, string>>, reason: string): Promise<void> {
  expectError(await result, reason);
}

type TestGoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
};

describe("ServerGoogleIdTokenVerifier", () => {
  it("normalizes a valid Google ID token payload", async () => {
    const calls: Array<{ idToken: string; audience: string }> = [];
    const verifier = new ServerGoogleIdTokenVerifier({
      audience,
      clock: fixedClock,
      verifier: fakeGoogleVerifier(({ idToken, audience: verifierAudience }) => {
        calls.push({ idToken, audience: verifierAudience });
        return validPayload();
      }),
    });

    await expect(verifier.verifyIdToken(token)).resolves.toEqual(Result.ok({
        issuer: "https://accounts.google.com",
        subject: "google-subject",
        audience,
        expiresAt: new Date(futureExpiration * 1000),
    }));
    expect(calls).toEqual([{ idToken: token, audience }]);
  });

  it("accepts Google issuer values returned by the official verifier", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), iss: "accounts.google.com" });

    const result = await verifier.verifyIdToken(token);

    expect(Result.isOk(result)).toBe(true);
  });

  it("maps invalid verifier errors safely", async () => {
    const verifier = new ServerGoogleIdTokenVerifier({
      audience,
      clock: fixedClock,
      verifier: throwingGoogleVerifier(new Error(`invalid token ${token}`)),
    });

    const result = await verifier.verifyIdToken(token);

    expectError(result, "invalid");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("maps expired verifier errors safely", async () => {
    const verifier = new ServerGoogleIdTokenVerifier({
      audience,
      clock: fixedClock,
      verifier: throwingGoogleVerifier(new Error("Token used too late, expired")),
    });

    await expectAsyncError(verifier.verifyIdToken(token), "expired");
  });

  it("maps audience verifier errors safely", async () => {
    const verifier = new ServerGoogleIdTokenVerifier({
      audience,
      clock: fixedClock,
      verifier: throwingGoogleVerifier(new Error("Wrong recipient, audience mismatch")),
    });

    await expectAsyncError(verifier.verifyIdToken(token), "unsupported_audience");
  });

  it("rejects unsupported issuers", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), iss: "https://evil.example" });

    await expectAsyncError(verifier.verifyIdToken(token), "unsupported_issuer");
  });

  it("rejects audience mismatches", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), aud: "other-client-id" });

    await expectAsyncError(verifier.verifyIdToken(token), "unsupported_audience");
  });

  it("accepts array audiences that contain the configured audience", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), aud: ["other-client-id", audience] });

    const result = await verifier.verifyIdToken(token);

    expect(Result.isOk(result)).toBe(true);
  });

  it("rejects expired payloads", async () => {
    const verifier = createVerifierWithPayload({ ...validPayload(), exp: pastExpiration });

    await expectAsyncError(verifier.verifyIdToken(token), "expired");
  });

  it("rejects missing subjects", async () => {
    const payloadWithoutSubject = validPayload();
    delete payloadWithoutSubject.sub;
    const verifier = createVerifierWithPayload(payloadWithoutSubject);

    await expectAsyncError(verifier.verifyIdToken(token), "missing_subject");
  });

  it("rejects missing payloads", async () => {
    const verifier = new ServerGoogleIdTokenVerifier({
      audience,
      clock: fixedClock,
      verifier: {
        async verifyIdToken() {
          return {
            getPayload() {
              return undefined;
            },
          };
        },
      },
    });

    await expectAsyncError(verifier.verifyIdToken(token), "invalid");
  });
});

function createVerifierWithPayload(payload: TestGoogleIdTokenPayload): ServerGoogleIdTokenVerifier {
  return new ServerGoogleIdTokenVerifier({
    audience,
    clock: fixedClock,
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
      return {
        getPayload() {
          return payload(input);
        },
      };
    },
  };
}

function throwingGoogleVerifier(error: Error): GoogleTokenVerifierDependency {
  return {
    async verifyIdToken() {
      throw error;
    },
  };
}
