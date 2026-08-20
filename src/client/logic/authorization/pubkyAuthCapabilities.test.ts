import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import {
  parsePubkyAuthCapabilities,
  type PubkyAuthCapabilitiesParseErrorCode,
} from "./pubkyAuthCapabilities";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

function expectCapabilities(input: string) {
  const result = parsePubkyAuthCapabilities(input);

  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw new Error(result.error.code);
  }

  return result.value;
}

function expectError(input: string | null | undefined, code: PubkyAuthCapabilitiesParseErrorCode): void {
  const result = parsePubkyAuthCapabilities(input);

  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual({ code });
  }
}

describe("parsePubkyAuthCapabilities", () => {
  it("parses read-only capabilities", () => {
    expect(expectCapabilities("/pub/pubky.app/:r")).toEqual([
      { path: "/pub/pubky.app/", read: true, write: false },
    ]);
  });

  it("parses write-only capabilities", () => {
    expect(expectCapabilities("/pub/pubky.app/:w")).toEqual([
      { path: "/pub/pubky.app/", read: false, write: true },
    ]);
  });

  it("parses read-write capabilities", () => {
    expect(expectCapabilities("/pub/pubky.app/:rw")).toEqual([
      { path: "/pub/pubky.app/", read: true, write: true },
    ]);
  });

  it("accepts repeated actions allowed by the Pubky auth ABNF", () => {
    expect(expectCapabilities("/pub/pubky.app/:rrw")).toEqual([
      { path: "/pub/pubky.app/", read: true, write: true },
    ]);
  });

  it("parses comma-separated capabilities", () => {
    expect(expectCapabilities("/pub/pubky.app/:rw,/pub/eventky/:r,/pub/mapky/:w")).toEqual([
      { path: "/pub/pubky.app/", read: true, write: true },
      { path: "/pub/eventky/", read: true, write: false },
      { path: "/pub/mapky/", read: false, write: true },
    ]);
  });

  it("accepts the capability count limit and rejects limit plus one", () => {
    const capability = "/pub/app/:r";
    expect(expectCapabilities(Array(PUBKY_AUTH_REQUEST_LIMITS.capabilityCount).fill(capability).join(","))).toHaveLength(
      PUBKY_AUTH_REQUEST_LIMITS.capabilityCount,
    );
    expectError(
      Array(PUBKY_AUTH_REQUEST_LIMITS.capabilityCount + 1).fill(capability).join(","),
      "too_many_capabilities",
    );
  });

  it("accepts the capability string limit and rejects limit plus one", () => {
    const prefix = "/a:";
    const atLimit = `${prefix}${"r".repeat(PUBKY_AUTH_REQUEST_LIMITS.capabilityLength - prefix.length)}`;
    const overLimit = `${atLimit}r`;

    expect(expectCapabilities(atLimit)).toHaveLength(1);
    expectError(overLimit, "capability_too_long");
  });

  it("accepts the capability path limit and rejects limit plus one", () => {
    const fullSegment = "a".repeat(255);
    const prefix = `/${fullSegment}/${fullSegment}/${fullSegment}/`;
    const atLimit = `${prefix}${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.capabilityPathLength - prefix.length)}`;
    const overLimit = `${atLimit}a`;

    expect(expectCapabilities(`${atLimit}:r`)[0]?.path).toBe(atLimit);
    expectError(`${overLimit}:r`, "capability_too_long");
  });

  it("preserves file-scope paths exactly", () => {
    expect(expectCapabilities("/pub/file.txt:r")).toEqual([
      { path: "/pub/file.txt", read: true, write: false },
    ]);
  });

  it("accepts canonical decoded Pubky storage paths", () => {
    expect(expectCapabilities("/pub/My File/über/%7Efile:r")).toEqual([
      { path: "/pub/My File/über/%7Efile", read: true, write: false },
    ]);
  });

  it("bounds multibyte path segments by UTF-8 length", () => {
    expect(expectCapabilities(`/${"ü".repeat(127)}:r`)).toHaveLength(1);
    expectError(`/${"ü".repeat(128)}:r`, "invalid_capability_path");
  });

  it("reports multibyte paths over 972 UTF-8 bytes as too long", () => {
    const fullSegment = `${"ü".repeat(124)}a`;
    const finalSegment = `${"ü".repeat(110)}a`;
    const atLimit = `/${fullSegment}/${fullSegment}/${fullSegment}/${finalSegment}`;

    expect(expectCapabilities(`${atLimit}:r`)).toHaveLength(1);
    expectError(`${atLimit}a:r`, "capability_too_long");
  });

  it("rejects missing capability strings", () => {
    expectError(null, "missing_capabilities");
    expectError(undefined, "missing_capabilities");
    expect(expectCapabilities("")).toEqual([]);
    expectError("   ", "invalid_capability_path");
  });

  it("rejects empty comma-separated entries", () => {
    expectError("/pub/a/:r,,/pub/b/:w", "empty_capability");
    expectError(",/pub/a/:r", "empty_capability");
    expectError("/pub/a/:r,", "empty_capability");
  });

  it("rejects leading and trailing whitespace instead of normalizing it", () => {
    expectError(" /pub/pubky.app/:r", "invalid_capability_path");
    expectError("/pub/pubky.app/:r ", "unsupported_capability_actions");
    expectError("/pub/a/:r, /pub/b/:w", "invalid_capability_path");
  });

  it("rejects invalid paths", () => {
    expectError("pub/pubky.app/:rw", "invalid_capability_path");
    expectError("/pub/app\tname/:rw", "invalid_capability_path");
    expectError("/pub/app\\name/:rw", "invalid_capability_path");
    expectError("/pub//app/:rw", "invalid_capability_path");
    expectError("/pub/../app/:rw", "invalid_capability_path");
    expectError("/pub/app :rw", "invalid_capability_path");
    expectError("/pub/example.com/time:series:r", "unsupported_capability_actions");
  });

  it("rejects missing or unsupported actions", () => {
    expectError("/pub/pubky.app/", "invalid_capability_path");
    expectError("/pub/pubky.app/:", "unsupported_capability_actions");
    expectError("/pub/pubky.app/:admin", "unsupported_capability_actions");
    expectError("/pub/pubky.app/:x", "unsupported_capability_actions");
  });
});
