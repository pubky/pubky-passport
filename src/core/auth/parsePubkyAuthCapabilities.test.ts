import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import {
  parsePubkyAuthCapabilities,
  type PubkyAuthCapabilitiesParseErrorCode,
} from "./parsePubkyAuthCapabilities";
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
    expect(result.error.code).toBe(code);
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
    const atLimit = `/${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.capabilityPathLength - 1)}`;
    const overLimit = `${atLimit}a`;

    expect(expectCapabilities(`${atLimit}:r`)[0]?.path).toBe(atLimit);
    expectError(`${overLimit}:r`, "capability_too_long");
  });

  it("preserves file-scope paths exactly", () => {
    expect(expectCapabilities("/pub/file.txt:r")).toEqual([
      { path: "/pub/file.txt", read: true, write: false },
    ]);
  });

  it("preserves colon-containing paths by splitting on the last colon", () => {
    expect(expectCapabilities("/pub/example.com/time:series:r")).toEqual([
      { path: "/pub/example.com/time:series", read: true, write: false },
    ]);
  });

  it("accepts RFC-style path characters and percent-encoding", () => {
    expect(expectCapabilities("/pub/app-._~!$&'()*+;=:@/%7Efile:r")).toEqual([
      { path: "/pub/app-._~!$&'()*+;=:@/%7Efile", read: true, write: false },
    ]);
  });

  it("rejects missing capability strings", () => {
    expectError(null, "missing_capabilities");
    expectError(undefined, "missing_capabilities");
    expectError("", "missing_capabilities");
    expectError("   ", "missing_capabilities");
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
    expectError("/pub/app?query:r", "invalid_capability_path");
    expectError("/pub/app#fragment:r", "invalid_capability_path");
    expectError("/pub/my app/:rw", "invalid_capability_path");
    expectError("/pub/app\tname/:rw", "invalid_capability_path");
    expectError("/pub/app[name]/:rw", "invalid_capability_path");
    expectError("/pub/app/%XX:r", "invalid_capability_path");
    expectError("/pub/app/%A:r", "invalid_capability_path");
  });

  it("rejects missing or unsupported actions", () => {
    expectError("/pub/pubky.app/", "invalid_capability_path");
    expectError("/pub/pubky.app/:", "unsupported_capability_actions");
    expectError("/pub/pubky.app/:admin", "unsupported_capability_actions");
    expectError("/pub/pubky.app/:x", "unsupported_capability_actions");
  });
});
