import { describe, expect, it } from "vitest";

import { parseGoogleWrappingKeyServerConfig } from "./googleWrappingKeyConfig";

const VALID_SERVER_SECRET = Buffer.alloc(32, 1).toString("base64");

const VALID_GOOGLE_WRAPPING_KEY_SERVER_CONFIG = {
  NODE_ENV: "production",
  PASSPORT_SERVER_SECRET_BASE64: VALID_SERVER_SECRET,
};

describe("Google wrapping-key server config", () => {
  it("parses Google wrapping-key config without Homegate configuration", () => {
    expect(parseGoogleWrappingKeyServerConfig(VALID_GOOGLE_WRAPPING_KEY_SERVER_CONFIG)).toEqual({
      PASSPORT_SERVER_SECRET_BASE64: VALID_SERVER_SECRET,
    });
  });

  it("fails invalid base64 server secrets", () => {
    expect(() =>
      parseGoogleWrappingKeyServerConfig({
        ...VALID_GOOGLE_WRAPPING_KEY_SERVER_CONFIG,
        PASSPORT_SERVER_SECRET_BASE64: "not-base64!",
      }),

    ).toThrow();
  });

  it("fails base64 server secrets shorter than 32 decoded bytes", () => {
    expect(() =>
      parseGoogleWrappingKeyServerConfig({
        ...VALID_GOOGLE_WRAPPING_KEY_SERVER_CONFIG,
        PASSPORT_SERVER_SECRET_BASE64: Buffer.alloc(31, 1).toString("base64"),
      }),
    ).toThrow();
  });
});
