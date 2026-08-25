import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { encodeBase64Url } from "../../../libs/encoding/base64Url";
import {
  normalizePassportFileOrigin,
  parsePassportFileContents,
  parsePassportFileEnvelope,
  type PassportFileEnvelopeV1,
} from "./passportFileEnvelope";

const VALID_ENVELOPE = {
  v: 1,
  iv: "AAECAwQFBgcICQoL",
  ct: "YZy1I_a6WzFnql8rW2A94EJrgz38Sqd1LV_KjVe2Qd2n1mvFMXg9qzRHwJ_WQvrm",
  url: "https://passport.pubky.app",
} satisfies PassportFileEnvelopeV1;

type PassportFileField = keyof typeof VALID_ENVELOPE | "kid";
type PassportFileParseErrorCode = "invalid_json" | "invalid_file" | "unsupported_version";
const PASSPORT_FILE_FIELDS = Object.keys(VALID_ENVELOPE) as PassportFileField[];

function stringifyEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...VALID_ENVELOPE, ...overrides });
}

function expectParseError(
  input: unknown,
  code: PassportFileParseErrorCode,
  field?: PassportFileField,
): void {
  void field;
  const result = parsePassportFileContents(input);

  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual({ code });
    expect(JSON.stringify(result.error)).not.toContain(VALID_ENVELOPE.iv);
    expect(JSON.stringify(result.error)).not.toContain(VALID_ENVELOPE.ct);
  }
}

describe("parsePassportFileContents", () => {
  it("parses a valid v1 envelope", () => {
    const result = parsePassportFileContents(stringifyEnvelope());

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value).toEqual(VALID_ENVELOPE);
  });

  it("normalizes root-path urls to origin-only output", () => {
    const result = parsePassportFileContents(stringifyEnvelope({ url: "https://passport.pubky.app/" }));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.url).toBe("https://passport.pubky.app");
  });

  it("rejects malformed JSON", () => {
    expectParseError("{", "invalid_json");
    expectParseError(undefined, "invalid_json");
  });

  it("rejects non-object JSON shapes", () => {
    for (const input of ["null", "[]", '"passport"', "1", "true"]) {
      expectParseError(input, "invalid_file");
    }
  });

  it("rejects missing required fields with typed field errors", () => {
    for (const field of PASSPORT_FILE_FIELDS) {
      const envelope: Record<string, unknown> = { ...VALID_ENVELOPE };
      delete envelope[field];

      expectParseError(JSON.stringify(envelope), "invalid_file", field);
    }
  });

  it("rejects unknown top-level fields", () => {
    expectParseError(stringifyEnvelope({ plaintext: "do-not-accept" }), "invalid_file");
  });

  it("rejects unsupported numeric versions", () => {
    for (const version of [0, 3, 1.5]) {
      expectParseError(stringifyEnvelope({ v: version }), "unsupported_version", "v");
    }
  });

  it("detects unsupported versions before applying the strict v1 shape", () => {
    expectParseError(
      stringifyEnvelope({ v: 3, futureField: true }),
      "unsupported_version",
      "v",
    );
  });

  it("parses v2 envelopes with a public key ID", () => {
    const result = parsePassportFileContents(stringifyEnvelope({ v: 2, kid: "2026-08" }));

    expect(Result.isOk(result) && result.value).toEqual({
      ...VALID_ENVELOPE,
      v: 2,
      kid: "2026-08",
    });
  });

  it.each(["", "spaces are invalid", "?", "x".repeat(33)])("rejects invalid v2 key ID %s", (kid) => {
    expectParseError(stringifyEnvelope({ v: 2, kid }), "invalid_file", "kid");
  });

  it("rejects invalid version field types", () => {
    for (const version of ["1", null, true]) {
      expectParseError(stringifyEnvelope({ v: version }), "invalid_file", "v");
    }
  });

  it("rejects empty and non-base64url iv values", () => {
    for (const iv of ["", "abc+123", "abc/123", "abc=", "abc 123", "AB", null]) {
      expectParseError(stringifyEnvelope({ iv }), "invalid_file", "iv");
    }
  });

  it("rejects canonically encoded iv values with the wrong decoded length", () => {
    for (const byteLength of [11, 13]) {
      expectParseError(
        stringifyEnvelope({ iv: encodeBase64Url(new Uint8Array(byteLength)) }),
        "invalid_file",
        "iv",
      );
    }
  });

  it("rejects empty and non-base64url ciphertext values", () => {
    for (const ct of ["", "abc+123", "abc/123", "abc=", "abc 123", "AB", null]) {
      expectParseError(stringifyEnvelope({ ct }), "invalid_file", "ct");
    }
  });

  it("rejects canonically encoded ciphertext values with the wrong decoded length", () => {
    for (const byteLength of [47, 49]) {
      expectParseError(
        stringifyEnvelope({ ct: encodeBase64Url(new Uint8Array(byteLength)) }),
        "invalid_file",
        "ct",
      );
    }
  });

  it("rejects unsafe or non-origin url values", () => {
    for (const url of [
      "not-a-url",
      "http://passport.pubky.app",
      "javascript:alert(1)",
      "data:text/plain,hello",
      "file:///tmp/passport.json",
      "blob:https://passport.pubky.app/id",
      "https://user:pass@passport.pubky.app",
      "https://passport.pubky.app?token=secret",
      "https://passport.pubky.app#secret",
      "https://passport.pubky.app/path",
      " https://passport.pubky.app",
      null,
    ]) {
      expectParseError(stringifyEnvelope({ url }), "invalid_file", "url");
    }
  });

  it("rejects non-HTTPS urls", () => {
    expectParseError(stringifyEnvelope({ url: "http://passport.pubky.app/" }), "invalid_file", "url");
  });

  it("parses already-decoded envelope objects", () => {
    const result = parsePassportFileEnvelope({ ...VALID_ENVELOPE, url: "https://passport.pubky.app/" });

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.url).toBe("https://passport.pubky.app");
  });
});

describe("normalizePassportFileOrigin", () => {
  it("returns origin-only urls", () => {
    const result = normalizePassportFileOrigin("https://passport.pubky.app/");
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toBe("https://passport.pubky.app");
    }
  });

  it("rejects invalid origins without returning input values", () => {
    const result = normalizePassportFileOrigin("https://passport.pubky.app/private?secret=value");

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "invalid_field", field: "url" });
    }
    expect(JSON.stringify(result)).not.toContain("secret=value");
  });
});
