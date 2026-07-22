import { describe, expect, it } from "vitest";

import { parseGoogleWrappingKeyServerEnv, parseHomegateServerEnv } from "./server-env-parser";

const validServerSecret = Buffer.alloc(32, 1).toString("base64");

const validGoogleWrappingKeyServerEnv = {
  NODE_ENV: "production",
  GOOGLE_CLIENT_ID: "google-client-id",
  PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
};

describe("server environment parsers", () => {
  it("parses Google wrapping-key config without Homegate configuration", () => {
    expect(parseGoogleWrappingKeyServerEnv(validGoogleWrappingKeyServerEnv)).toEqual({
      GOOGLE_CLIENT_ID: "google-client-id",
      PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
    });
  });

  it("fails when Google wrapping-key values are missing", () => {
    expect(() =>
      parseGoogleWrappingKeyServerEnv({
        ...validGoogleWrappingKeyServerEnv,
        GOOGLE_CLIENT_ID: undefined,
      }),
    ).toThrow();
  });

  it("parses Homegate config without unrelated wrapping-key secrets", () => {
    expect(
      parseHomegateServerEnv({
        NODE_ENV: "production",
        HOMEGATE_URL: "https://homegate.pubky.app",
      }),
    ).toEqual({
      HOMEGATE_URL: "https://homegate.pubky.app",
    });
  });

  it("allows localhost HTTP Homegate URLs in development", () => {
    expect(
      parseHomegateServerEnv({
        NODE_ENV: "development",
        HOMEGATE_URL: "http://127.0.0.1:8080",
      }),
    ).toEqual({
      HOMEGATE_URL: "http://127.0.0.1:8080",
    });
  });

  it.each([
    undefined,
    "not a url",
    "http://homegate.pubky.app",
  ])("rejects invalid Homegate URLs in production", (homegateUrl) => {
    expect(() =>
      parseHomegateServerEnv({
        NODE_ENV: "production",
        HOMEGATE_URL: homegateUrl,
      }),
    ).toThrow();
  });

  it("fails invalid base64 server secrets", () => {
    expect(() =>
      parseGoogleWrappingKeyServerEnv({
        ...validGoogleWrappingKeyServerEnv,
        PASSPORT_SERVER_SECRET_BASE64: "not-base64!",
      }),

    ).toThrow();
  });

  it("fails base64 server secrets shorter than 32 decoded bytes", () => {
    expect(() =>
      parseGoogleWrappingKeyServerEnv({
        ...validGoogleWrappingKeyServerEnv,
        PASSPORT_SERVER_SECRET_BASE64: Buffer.alloc(31, 1).toString("base64"),
      }),
    ).toThrow();
  });
});
