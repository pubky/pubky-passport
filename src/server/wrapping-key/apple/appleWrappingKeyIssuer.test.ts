import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { expectAsyncResultError, expectResultOk } from "@test-utils/resultAssertions";
import { deriveWrappingKey } from "../deriveWrappingKey";
import { AppleWrappingKeyIssuer } from "./AppleWrappingKeyIssuer";

const SECRET = Buffer.alloc(32, 2);
const SECRETS = new Map([["current", SECRET]]);
const APPLE_IDENTITY = {
  provider: "apple" as const,
  issuer: "https://appleid.apple.com",
  subject: "001234.abcdef.1234",
};

type Verify = ConstructorParameters<typeof AppleWrappingKeyIssuer>[3];

function issuerWith(verifyIdToken: NonNullable<Verify>["verifyIdToken"]) {
  return new AppleWrappingKeyIssuer("services.id", "current", SECRETS, { verifyIdToken });
}

describe("Apple wrapping-key issuer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("derives with the apple: HKDF prefix", async () => {
    const issuer = issuerWith(async () => Result.ok(APPLE_IDENTITY));

    const issued = expectResultOk(await issuer.issueWrappingKey("id-token"));

    expect(issued).toEqual({
      wrappingKey: deriveWrappingKey(SECRET, APPLE_IDENTITY),
      keyId: "current",
    });
  });

  it("never derives the Google key for the same subject", () => {
    const apple = deriveWrappingKey(SECRET, APPLE_IDENTITY);
    const google = deriveWrappingKey(SECRET, {
      provider: "google",
      issuer: APPLE_IDENTITY.issuer,
      subject: APPLE_IDENTITY.subject,
    });
    expect(apple).not.toBe(google);
  });

  it("preserves the frozen Apple HKDF fixture", () => {
    expect(
      deriveWrappingKey(
        Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex"),
        APPLE_IDENTITY,
      ),
    ).toBe(APPLE_FIXTURE);
  });

  it("refuses an identity verified for another provider", async () => {
    vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const issuer = issuerWith(async () => Result.ok({ ...APPLE_IDENTITY, provider: "google" }));

    await expectAsyncResultError(issuer.issueWrappingKey("id-token"), {
      code: "key_derivation_failed",
    });
  });

  it("passes token rejections through and maps verifier exceptions", async () => {
    vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    await expectAsyncResultError(
      issuerWith(async () => Result.err({ code: "invalid_apple_id_token" })).issueWrappingKey("t"),
      { code: "invalid_apple_id_token" },
    );
    const thrown = await issuerWith(async () => {
      throw new Error("down");
    }).issueWrappingKey("t");
    expect(Result.isError(thrown) && thrown.error.code).toBe("apple_verifier_unavailable");
  });

  it("is off unless Apple login is enabled", () => {
    vi.stubEnv("APPLE_LOGIN_ENABLED", "");
    expect(AppleWrappingKeyIssuer.fromEnvironment()).toBeNull();
  });

  it("constructs the configured server flow", () => {
    vi.stubEnv("APPLE_LOGIN_ENABLED", "true");
    vi.stubEnv("APPLE_SERVICES_ID", "app.pubky.passport.signin");
    vi.stubEnv("APPLE_CLOUDKIT_CONTAINER_ID", "iCloud.app.pubky.passport");
    vi.stubEnv("APPLE_CLOUDKIT_API_TOKEN", "a".repeat(64));
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({ current: SECRET.toString("base64") }),
    );
    expect(AppleWrappingKeyIssuer.fromEnvironment()).toBeInstanceOf(AppleWrappingKeyIssuer);
  });
});

/** Computed independently with node:crypto hkdfSync over "apple:<iss>\n<sub>". */
const APPLE_FIXTURE = "RCbpoaB8RVBGxf2UFtDmsawfCE6MZircgGp8870bAAg";
