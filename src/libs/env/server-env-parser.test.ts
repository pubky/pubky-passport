import { describe, expect, it } from "vitest";

import { parseGoogleWrappingKeyServerEnv } from "./server-env-parser";

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
