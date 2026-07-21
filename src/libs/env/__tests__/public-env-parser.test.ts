import { describe, expect, it } from "vitest";

import { parsePublicEnv } from "../public-env-parser";

const validPublicEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "https://passport.pubky.app",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "google-client-id",
  NEXT_PUBLIC_HTTP_RELAY_URL: "https://httprelay.pubky.app/inbox",
};

describe("parsePublicEnv", () => {
  it("parses required public browser config", () => {
    expect(parsePublicEnv(validPublicEnv)).toEqual({
      NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "https://passport.pubky.app",
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "google-client-id",
      NEXT_PUBLIC_HTTP_RELAY_URL: "https://httprelay.pubky.app/inbox",
    });
  });

  it("fails when required values are missing", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: undefined,
      }),
    ).toThrow();
  });

  it("fails invalid URLs", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_HTTP_RELAY_URL: "not a url",
      }),
    ).toThrow();
  });

  it("fails non-HTTPS URLs in production", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "http://passport.pubky.app",
      }),
    ).toThrow();
  });

  it("fails unsafe URL schemes", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_HTTP_RELAY_URL: "javascript:alert(1)",
      }),
    ).toThrow();
  });

  it("allows localhost HTTP URLs in development", () => {
    expect(
      parsePublicEnv({
        ...validPublicEnv,
        NODE_ENV: "development",
        NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "http://localhost:3000",
        NEXT_PUBLIC_HTTP_RELAY_URL: "http://127.0.0.1:8080/inbox",
      }),
    ).toEqual({
      NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "http://localhost:3000",
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "google-client-id",
      NEXT_PUBLIC_HTTP_RELAY_URL: "http://127.0.0.1:8080/inbox",
    });
  });

  it("fails non-localhost HTTP URLs in development", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NODE_ENV: "development",
        NEXT_PUBLIC_HTTP_RELAY_URL: "http://httprelay.pubky.app/inbox",
      }),
    ).toThrow();
  });

  it("strips server-only values from parsed public config", () => {
    const parsed = parsePublicEnv({
      ...validPublicEnv,
      PASSPORT_SERVER_SECRET_BASE64: Buffer.alloc(32).toString("base64"),
    });

    expect(parsed).not.toHaveProperty("PASSPORT_SERVER_SECRET_BASE64");
  });
});
