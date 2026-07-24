import { describe, expect, it } from "vitest";

import { parsePublicEnv } from "./public-env-parser";

const validPublicEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "https://passport.pubky.app",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "google-client-id",
  NEXT_PUBLIC_HOMEGATE_URL: "https://homegate.example/",
};

describe("parsePublicEnv", () => {
  it("parses required public browser config", () => {
    expect(parsePublicEnv(validPublicEnv)).toEqual({
      NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "https://passport.pubky.app",
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "google-client-id",
      NEXT_PUBLIC_HOMEGATE_URL: "https://homegate.example/",
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

  it("fails non-HTTPS URLs in production", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "http://passport.pubky.app",
      }),
    ).toThrow();
  });

  it("rejects a non-HTTPS Homegate URL", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_HOMEGATE_URL: "http://homegate.example",
      }),
    ).toThrow();
  });

  it("rejects HTTP URLs in development", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NODE_ENV: "development",
        NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "http://passport.pubky.app",
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
