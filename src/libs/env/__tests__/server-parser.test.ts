import { describe, expect, it } from "vitest";

import { parseHomegateInviteServerEnv, parseServerEnv } from "../server-parser";

const validServerSecret = Buffer.alloc(32, 1).toString("base64");

const validServerEnv = {
  NODE_ENV: "production",
  GOOGLE_CLIENT_ID: "google-client-id",
  PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
  HOMEGATE_URL: "https://homegate.pubky.app",
};

describe("parseServerEnv", () => {
  it("parses required server-only config", () => {
    expect(parseServerEnv(validServerEnv)).toEqual({
      GOOGLE_CLIENT_ID: "google-client-id",
      PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
      HOMEGATE_URL: "https://homegate.pubky.app",
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
        HOMEGATE_URL: "not a url",
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
      }),
    ).toEqual({
      GOOGLE_CLIENT_ID: "google-client-id",
      PASSPORT_SERVER_SECRET_BASE64: validServerSecret,
      HOMEGATE_URL: "http://localhost:4000",
    });
  });

  it("parses Homegate invite route config without unrelated server secrets", () => {
    expect(
      parseHomegateInviteServerEnv({
        NODE_ENV: "production",
        HOMEGATE_URL: "https://homegate.pubky.app",
      }),
    ).toEqual({
      HOMEGATE_URL: "https://homegate.pubky.app",
    });
  });

  it("allows localhost HTTP Homegate invite URLs in development", () => {
    expect(
      parseHomegateInviteServerEnv({
        NODE_ENV: "development",
        HOMEGATE_URL: "http://127.0.0.1:8080",
      }),
    ).toEqual({
      HOMEGATE_URL: "http://127.0.0.1:8080",
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
