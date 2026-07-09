import { describe, expect, it } from "vitest";

import {
  normalizePassportFileOrigin,
  parsePassportFileContents,
  parsePassportFileEnvelope,
  type PassportFileField,
  type PassportFileParseErrorCode,
} from "./parsePassportFile";
import type { PassportFileEnvelopeV1 } from "../../domain/passport-file/passportFile";

const validEnvelope = {
  v: 1,
  iv: "abc123_-",
  ct: "ciphertext_123-ABC",
  url: "https://passport.pubky.app",
} satisfies PassportFileEnvelopeV1;

const passportFileFields = Object.keys(validEnvelope) as PassportFileField[];

function stringifyEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...validEnvelope, ...overrides });
}

function expectParseError(
  input: unknown,
  code: PassportFileParseErrorCode,
  field?: PassportFileField,
): void {
  const result = parsePassportFileContents(input);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toEqual(field ? { code, field } : { code });
    expect(JSON.stringify(result.error)).not.toContain(validEnvelope.iv);
    expect(JSON.stringify(result.error)).not.toContain(validEnvelope.ct);
  }
}

describe("parsePassportFileContents", () => {
  it("parses a valid v1 envelope", () => {
    const result = parsePassportFileContents(stringifyEnvelope());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.envelope).toEqual(validEnvelope);
  });

  it("normalizes root-path urls to origin-only output", () => {
    const result = parsePassportFileContents(stringifyEnvelope({ url: "https://passport.pubky.app/" }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.envelope.url).toBe("https://passport.pubky.app");
  });

  it("rejects malformed JSON", () => {
    expectParseError("{", "invalid_json");
    expectParseError(undefined, "invalid_json");
  });

  it("rejects non-object JSON shapes", () => {
    for (const input of ["null", "[]", '"passport"', "1", "true"]) {
      expectParseError(input, "invalid_shape");
    }
  });

  it("rejects missing required fields with typed field errors", () => {
    for (const field of passportFileFields) {
      const envelope: Record<string, unknown> = { ...validEnvelope };
      delete envelope[field];

      expectParseError(JSON.stringify(envelope), "missing_field", field);
    }
  });

  it("rejects unknown top-level fields", () => {
    expectParseError(stringifyEnvelope({ plaintext: "do-not-accept" }), "unknown_field");
  });

  it("rejects unsupported numeric versions", () => {
    for (const version of [0, 2, 1.5]) {
      expectParseError(stringifyEnvelope({ v: version }), "unsupported_version", "v");
    }
  });

  it("rejects invalid version field types", () => {
    for (const version of ["1", null, true]) {
      expectParseError(stringifyEnvelope({ v: version }), "invalid_field", "v");
    }
  });

  it("rejects empty and non-base64url iv values", () => {
    for (const iv of ["", "abc+123", "abc/123", "abc=", "abc 123", null]) {
      expectParseError(stringifyEnvelope({ iv }), "invalid_field", "iv");
    }
  });

  it("rejects empty and non-base64url ciphertext values", () => {
    for (const ct of ["", "abc+123", "abc/123", "abc=", "abc 123", null]) {
      expectParseError(stringifyEnvelope({ ct }), "invalid_field", "ct");
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
      expectParseError(stringifyEnvelope({ url }), "invalid_field", "url");
    }
  });

  it("allows localhost http urls only when explicitly enabled", () => {
    expectParseError(stringifyEnvelope({ url: "http://localhost:3000/" }), "invalid_field", "url");

    const result = parsePassportFileContents(stringifyEnvelope({ url: "http://localhost:3000/" }), {
      allowLocalhostHttp: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.envelope.url).toBe("http://localhost:3000");
  });

  it("parses already-decoded envelope objects", () => {
    const result = parsePassportFileEnvelope({ ...validEnvelope, url: "https://passport.pubky.app/" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.envelope.url).toBe("https://passport.pubky.app");
  });
});

describe("normalizePassportFileOrigin", () => {
  it("returns origin-only urls", () => {
    expect(normalizePassportFileOrigin("https://passport.pubky.app/")).toEqual({
      ok: true,
      origin: "https://passport.pubky.app",
    });
  });

  it("rejects invalid origins without returning input values", () => {
    const result = normalizePassportFileOrigin("https://passport.pubky.app/private?secret=value");

    expect(result).toEqual({ ok: false, error: { code: "invalid_field", field: "url" } });
    expect(JSON.stringify(result)).not.toContain("secret=value");
  });
});
