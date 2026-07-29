import { describe, expect, it } from "vitest";

import { parseGoogleWrappingKeyServerSecret } from "./googleWrappingKeyServerSecret";

const VALID_SERVER_SECRET = Buffer.alloc(32, 1).toString("base64");

const VALID_ENV = {
  PASSPORT_SERVER_SECRET_BASE64: VALID_SERVER_SECRET,
};

describe("Google wrapping-key server secret", () => {
  it("decodes valid server secret configuration", () => {
    expect(parseGoogleWrappingKeyServerSecret(VALID_ENV)).toEqual(Buffer.alloc(32, 1));
  });

  it.each(["not-base64!", "base64url_value"])("rejects invalid base64 server secrets", (value) => {
    expect(() => parseGoogleWrappingKeyServerSecret({ ...VALID_ENV, PASSPORT_SERVER_SECRET_BASE64: value }))
      .toThrow();
  });

  it("fails base64 server secrets shorter than 32 decoded bytes", () => {
    expect(() =>
      parseGoogleWrappingKeyServerSecret({
        ...VALID_ENV,
        PASSPORT_SERVER_SECRET_BASE64: Buffer.alloc(31, 1).toString("base64"),
      }),
    ).toThrow();
  });

  it("requires server secret configuration", () => {
    expect(() => parseGoogleWrappingKeyServerSecret({})).toThrow();
  });
});
