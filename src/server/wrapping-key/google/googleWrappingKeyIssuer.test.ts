import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { OAuth2Client } from "google-auth-library";

import { LOGGER } from "@/libs/logger/logger";
import { stubPassportEnvironment } from "@test-utils/passportEnvironment";
import {
  expectAsyncResultError,
  expectResultError,
  expectResultOk,
} from "@test-utils/resultAssertions";
import { GoogleIdTokenVerifier } from "./GoogleIdTokenVerifier";
import { GoogleWrappingKeyIssuer } from "./GoogleWrappingKeyIssuer";

const GOOGLE_CLIENT_ID = "google-client-id";
const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  googleSubject: "google-subject",
};
const CURRENT_SECRET = Buffer.alloc(32, 2);
/** The nonce's preimage, as only Passport's own client holds it. */
const PREIMAGE = Buffer.alloc(32, 9).toString("base64url");
const SECRETS = new Map([["current", CURRENT_SECRET]]);

describe("Google wrapping-key issuer", () => {
  it.each([
    ["no Google audience is configured", { GOOGLE_CLIENT_ID: "" }],
    [
      "the provider disables Google",
      { PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({ googleEnabled: false }) },
    ],
  ])("reports Google as unavailable when %s", (_, overrides) => {
    stubPassportEnvironment({
      ...overrides,
      PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: undefined,
      PASSPORT_SERVER_SECRET_KEYRING_JSON: undefined,
    });
    expectResultError(GoogleWrappingKeyIssuer.fromEnvironment(), { code: "google_unavailable" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the current secret when no key ID is requested", async () => {
    vi.spyOn(GoogleIdTokenVerifier.prototype, "verifyGoogleIdToken").mockResolvedValue(
      Result.ok(IDENTITY),
    );
    const issuer = new GoogleWrappingKeyIssuer(GOOGLE_CLIENT_ID, "current", SECRETS);

    const result = await issuer.issueGoogleWrappingKey("id-token", PREIMAGE);

    expect(Result.isOk(result) && result.value.keyId).toBe("current");
  });

  it("returns the current key ID for new files and retained keys for existing files", async () => {
    vi.spyOn(GoogleIdTokenVerifier.prototype, "verifyGoogleIdToken").mockResolvedValue(
      Result.ok(IDENTITY),
    );
    const issuer = new GoogleWrappingKeyIssuer(
      GOOGLE_CLIENT_ID,
      "current",
      new Map([
        ["old", Buffer.alloc(32, 3)],
        ["current", CURRENT_SECRET],
      ]),
    );

    const current = await issuer.issueGoogleWrappingKey("id-token", PREIMAGE);
    const old = await issuer.issueGoogleWrappingKey("id-token", PREIMAGE, "old");

    expect(Result.isOk(current) && current.value).toMatchObject({ keyId: "current" });
    expect(Result.isOk(old) && old.value).toMatchObject({ keyId: "old" });
    expect(Result.isOk(current) && Result.isOk(old) && current.value.wrappingKey).not.toBe(
      Result.isOk(old) && old.value.wrappingKey,
    );
  });

  it("rejects a key ID that is no longer retained", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(GoogleIdTokenVerifier.prototype, "verifyGoogleIdToken").mockResolvedValue(
      Result.ok(IDENTITY),
    );
    const issuer = new GoogleWrappingKeyIssuer(GOOGLE_CLIENT_ID, "current", SECRETS);

    await expectAsyncResultError(issuer.issueGoogleWrappingKey("id-token", PREIMAGE, "removed"), {
      code: "key_unavailable",
    });
    expect(warning).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      layer: "server",
      operation: "select_key",
      code: "key_unavailable",
    });
  });

  it("verifies the token against the hash of the preimage it came with", async () => {
    const verify = vi
      .spyOn(GoogleIdTokenVerifier.prototype, "verifyGoogleIdToken")
      .mockResolvedValue(Result.ok(IDENTITY));
    const issuer = new GoogleWrappingKeyIssuer(GOOGLE_CLIENT_ID, "current", SECRETS);

    expectResultOk(await issuer.issueGoogleWrappingKey("id-token", PREIMAGE));

    expect(verify).toHaveBeenCalledExactlyOnceWith(
      "id-token",
      createHash("sha256").update(Buffer.alloc(32, 9)).digest("base64url"),
    );
  });

  it.each(["", "short", `${"A".repeat(42)}B`])(
    "refuses a malformed preimage %j without asking Google",
    async (preimage) => {
      const verify = vi.spyOn(GoogleIdTokenVerifier.prototype, "verifyGoogleIdToken");
      const issuer = new GoogleWrappingKeyIssuer(GOOGLE_CLIENT_ID, "current", SECRETS);

      await expectAsyncResultError(issuer.issueGoogleWrappingKey("id-token", preimage), {
        code: "invalid_google_id_token",
      });
      expect(verify).not.toHaveBeenCalled();
    },
  );

  it("does not derive material for rejected tokens", async () => {
    vi.spyOn(GoogleIdTokenVerifier.prototype, "verifyGoogleIdToken").mockResolvedValue(
      Result.err({ code: "invalid_google_id_token" }),
    );
    const issuer = new GoogleWrappingKeyIssuer(GOOGLE_CLIENT_ID, "current", SECRETS);

    await expectAsyncResultError(
      issuer.issueGoogleWrappingKey("SECRET-GOOGLE-ID-TOKEN", PREIMAGE),
      {
        code: "invalid_google_id_token",
      },
    );
  });

  it("maps verifier exceptions to a safe dependency failure", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.spyOn(GoogleIdTokenVerifier.prototype, "verifyGoogleIdToken").mockRejectedValue(
      new Error("SECRET-GOOGLE-ID-TOKEN"),
    );
    const issuer = new GoogleWrappingKeyIssuer(GOOGLE_CLIENT_ID, "current", SECRETS);

    const result = await issuer.issueGoogleWrappingKey("id-token", PREIMAGE);
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected verifier failure.");
    expect(result.error.code).toBe("google_verifier_unavailable");
    expect(result.error.cause).toBeInstanceOf(Error);
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("propagates signing-certificate outages as verifier unavailability", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const cause = new Error("SECRET-GOOGLE-CERTIFICATE-FAILURE");
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockRejectedValue(cause);
    const issuer = new GoogleWrappingKeyIssuer(GOOGLE_CLIENT_ID, "current", SECRETS);

    const result = await issuer.issueGoogleWrappingKey("id-token", PREIMAGE);

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected verifier failure.");
    expect(result.error).toEqual({ code: "google_verifier_unavailable", cause });
    expect(error).toHaveBeenCalledWith("identity.google.id_token_verification.failed", {
      code: "google_verifier_unavailable",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-CERTIFICATE-FAILURE");
  });

  it("constructs the configured server flow", () => {
    stubPassportEnvironment({
      GOOGLE_CLIENT_ID,
      PASSPORT_SERVER_SECRET_KEYRING_JSON: JSON.stringify({
        current: CURRENT_SECRET.toString("base64"),
      }),
    });

    expect(expectResultOk(GoogleWrappingKeyIssuer.fromEnvironment())).toBeInstanceOf(
      GoogleWrappingKeyIssuer,
    );
  });

  it("still fails loudly when enabled Google has an invalid keyring", () => {
    stubPassportEnvironment({ PASSPORT_SERVER_SECRET_KEYRING_JSON: undefined });

    expect(() => GoogleWrappingKeyIssuer.fromEnvironment()).toThrow(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON is required.",
    );
  });
});
