import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { expectAsyncResultError } from "../../../../test-utils/resultAssertions";
import { GoogleWrappingKeyIssuer } from "./GoogleWrappingKeyIssuer";

const IDENTITY = {
  issuer: "https://accounts.google.com" as const,
  googleSubject: "google-subject",
};
const CURRENT_SECRET = Buffer.alloc(32, 2);
const SECRETS = new Map([["current", CURRENT_SECRET]]);

describe("Google wrapping-key issuer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the current secret when no key ID is requested", async () => {
    const issuer = new GoogleWrappingKeyIssuer(async () => Result.ok(IDENTITY), "current", SECRETS);

    const result = await issuer.issueGoogleWrappingKey("id-token");

    expect(Result.isOk(result) && result.value.keyId).toBe("current");
  });

  it("returns the current key ID for new files and retained keys for existing files", async () => {
    const issuer = new GoogleWrappingKeyIssuer(
      async () => Result.ok(IDENTITY),
      "current",
      new Map([
        ["old", Buffer.alloc(32, 3)],
        ["current", CURRENT_SECRET],
      ]),
    );

    const current = await issuer.issueGoogleWrappingKey("id-token");
    const old = await issuer.issueGoogleWrappingKey("id-token", "old");

    expect(Result.isOk(current) && current.value).toMatchObject({ keyId: "current" });
    expect(Result.isOk(old) && old.value).toMatchObject({ keyId: "old" });
    expect(Result.isOk(current) && Result.isOk(old) && current.value.wrappingKey).not.toBe(
      Result.isOk(old) && old.value.wrappingKey,
    );
  });

  it("rejects a key ID that is no longer retained", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const issuer = new GoogleWrappingKeyIssuer(async () => Result.ok(IDENTITY), "current", SECRETS);

    await expectAsyncResultError(issuer.issueGoogleWrappingKey("id-token", "removed"), {
      code: "key_unavailable",
    });
    expect(warning).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      layer: "server",
      operation: "select_key",
      code: "key_unavailable",
    });
  });

  it("does not derive material for rejected tokens", async () => {
    const issuer = new GoogleWrappingKeyIssuer(
      async () => Result.err({ code: "invalid_google_id_token" as const }),
      "current",
      SECRETS,
    );

    await expectAsyncResultError(issuer.issueGoogleWrappingKey("SECRET-GOOGLE-ID-TOKEN"), {
      code: "invalid_google_id_token",
    });
  });

  it("maps verifier exceptions to a safe dependency failure", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const issuer = new GoogleWrappingKeyIssuer(
      async () => {
        throw new Error("SECRET-GOOGLE-ID-TOKEN");
      },
      "current",
      SECRETS,
    );

    const result = await issuer.issueGoogleWrappingKey("id-token");
    expect(Result.isError(result) && result.error.code).toBe("dependency_unavailable");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("constructs the configured server flow", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        current: CURRENT_SECRET.toString("base64"),
      }),
    );

    expect(GoogleWrappingKeyIssuer.fromEnvironment().issueGoogleWrappingKey).toEqual(
      expect.any(Function),
    );
  });
});
