import { describe, expect, it } from "vitest";

import { parseServerEnv } from "../server-parser";

const validServerSecret = Buffer.alloc(32, 1).toString("base64");

const validServerEnv = {
  NODE_ENV: "production",
  GOOGLE_CLIENT_ID: "google-client-id",
  PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
  HOMEGATE_URL: "https://homegate.pubky.app",
  PUBKY_HOMESERVER: "https://homeserver.pubky.app",
};

describe("parseServerEnv", () => {
  it("parses required server-only config", () => {
    expect(parseServerEnv(validServerEnv)).toEqual({
      GOOGLE_CLIENT_ID: "google-client-id",
      PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
      HOMEGATE_URL: "https://homegate.pubky.app",
      PUBKY_HOMESERVER: "https://homeserver.pubky.app",
    });
  });

  it("fails when required values are missing", () => {
    expect(() =>
      parseServerEnv({
        ...validServerEnv,
        HOMEGATE_URL: undefined,
      }),
    ).toThrow();
  });

  it("fails invalid URLs", () => {
    expect(() =>
      parseServerEnv({
        ...validServerEnv,
        PUBKY_HOMESERVER: "not a url",
      }),
    ).toThrow();
  });

  it("fails non-HTTPS URLs in production", () => {
    expect(() =>
      parseServerEnv({
        ...validServerEnv,
        HOMEGATE_URL: "http://homegate.pubky.app",
      }),
    ).toThrow();
  });

  it("allows localhost HTTP URLs in development", () => {
    expect(
      parseServerEnv({
        ...validServerEnv,
        NODE_ENV: "development",
        HOMEGATE_URL: "http://localhost:4000",
        PUBKY_HOMESERVER: "http://127.0.0.1:6287",
      }),
    ).toEqual({
      GOOGLE_CLIENT_ID: "google-client-id",
      PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
      HOMEGATE_URL: "http://localhost:4000",
      PUBKY_HOMESERVER: "http://127.0.0.1:6287",
    });
  });

  it("fails invalid base64 server secrets", () => {
    expect(() =>
      parseServerEnv({
        ...validServerEnv,
        PASSPORT_SERVER_SECRET_BASE64: "not-base64!",
      }),

    ).toThrow();
  });

  it("fails base64 server secrets shorter than 32 decoded bytes", () => {
    expect(() =>
      parseServerEnv({
        ...validServerEnv,
        PASSPORT_SERVER_SECRET_BASE64: Buffer.alloc(31, 1).toString("base64"),
      }),
    ).toThrow();
  });
});
