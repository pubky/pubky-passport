import { describe, expect, it } from "vitest";

import { parseGoogleWrappingKeyServerConfig } from "./config";

const validServerSecret = Buffer.alloc(32, 1).toString("base64");

const validGoogleWrappingKeyServerConfig = {
  NODE_ENV: "production",
  PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
};

describe("Google wrapping-key server config", () => {
  it("parses Google wrapping-key config without Homegate configuration", () => {
    expect(parseGoogleWrappingKeyServerConfig(validGoogleWrappingKeyServerConfig)).toEqual({
      PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
    });
  });

  it("fails invalid base64 server secrets", () => {
    expect(() =>
      parseGoogleWrappingKeyServerConfig({
        ...validGoogleWrappingKeyServerConfig,
        PASSPORT_SERVER_SECRET_BASE64: "not-base64!",
      }),

    ).toThrow();
  });

  it("fails base64 server secrets shorter than 32 decoded bytes", () => {
    expect(() =>
      parseGoogleWrappingKeyServerConfig({
        ...validGoogleWrappingKeyServerConfig,
        PASSPORT_SERVER_SECRET_BASE64: Buffer.alloc(31, 1).toString("base64"),
      }),
    ).toThrow();
  });
});
