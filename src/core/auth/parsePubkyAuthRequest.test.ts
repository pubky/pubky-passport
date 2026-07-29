import { describe, expect, expectTypeOf, it } from "vitest";
import { Result } from "better-result";

import {
  getParserIssuedPubkyAuthCallbacks,
  isParserIssuedPubkyAuthRequest,
  parsePubkyAuthRequest,
  type PubkyAuthParseErrorCode,
} from "./parsePubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";
import type { PubkyAuthUrlValidationErrorCode } from "./validatePubkyAuthUrls";

const VALID_REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";
expectTypeOf<PubkyAuthUrlValidationErrorCode>().toMatchTypeOf<PubkyAuthParseErrorCode>();

function encodeRequest(request: string): string {
  return encodeURIComponent(request);
}

function expectError(input: unknown, code: PubkyAuthParseErrorCode): void {
  const result = parsePubkyAuthRequest(input);

  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error.code).toBe(code);
    expect(result.error.message).not.toContain("test-secret");
  }
}

describe("parsePubkyAuthRequest", () => {
  it("parses a valid x-callback-url Pubky auth request", () => {
    const result = parsePubkyAuthRequest(encodeRequest(VALID_REQUEST));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.review).toEqual({
      kind: "signin",
      capabilities: [
        {
          path: "/pub/pubky.app/",
          read: true,
          write: true,
          scope: "specific",
        },
      ],
      callbackAvailability: {
        success: true,
        error: true,
        cancel: true,
      },
      relayHost: "httprelay.pubky.app",
      requestingAppDisplayName: "pubky.app",
    });
    expect(JSON.stringify(result.value.review)).not.toContain("test-secret");
    expect(JSON.stringify(result.value.review)).not.toContain("passport-success");
    expect(JSON.stringify(result.value.review)).not.toContain("/inbox");
    expect(result.value.approval.sensitivePubkyAuthUrl).toContain("secret=test-secret");
    expect(isParserIssuedPubkyAuthRequest(result.value.approval)).toBe(true);
    expect(getParserIssuedPubkyAuthCallbacks(result.value.approval)).toEqual({
      success: "https://pubky.app/passport-success",
      error: "https://pubky.app/passport-error",
      cancel: "https://pubky.app/passport-cancel",
    });
    expect(result.value.relayOrigin).toBe("https://httprelay.pubky.app");
  });

  it("returns callbacks only for the exact parser-issued approval object", () => {
    const result = parsePubkyAuthRequest(encodeRequest(VALID_REQUEST));
    if (Result.isError(result)) throw new Error(result.error.code);

    const clone = { ...result.value.approval };

    expect(getParserIssuedPubkyAuthCallbacks(clone)).toBeUndefined();
    expect(getParserIssuedPubkyAuthCallbacks({ sensitivePubkyAuthUrl: result.value.approval.sensitivePubkyAuthUrl })).toBeUndefined();
  });

  it("accepts a client-provided HTTPS relay", () => {
    const result = parsePubkyAuthRequest(encodeRequest(
      VALID_REQUEST.replace("https://httprelay.pubky.app/inbox", "https://relay.client.example/custom-inbox"),
    ));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.relayOrigin).toBe("https://relay.client.example");
  });

  it("freezes parser-issued approvals before registering their provenance", () => {
    const result = parsePubkyAuthRequest(encodeRequest(VALID_REQUEST));
    if (Result.isError(result)) throw new Error(result.error.code);
    const originalRequest = result.value.approval.sensitivePubkyAuthUrl;

    const mutated = Reflect.set(
      result.value.approval,
      "sensitivePubkyAuthUrl",
      "pubkyauth://signin?secret=attacker-controlled",
    );

    expect(mutated).toBe(false);
    expect(Object.isFrozen(result.value.approval)).toBe(true);
    expect(result.value.approval.sensitivePubkyAuthUrl).toBe(originalRequest);
    expect(isParserIssuedPubkyAuthRequest(result.value.approval)).toBe(true);
  });

  it("parses the documented pubkyauth:/// form", () => {
    const request =
      "pubkyauth:///?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.review.kind).toBe("signin");
  });

  it("parses comma-separated capabilities", () => {
    const request =
      "pubkyauth://signin?caps=/pub/pubky.app/:rw,/pub/eventky/:r,/pub/mapky/:w&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.review.capabilities).toEqual([
      { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
      { path: "/pub/eventky/", read: true, write: false, scope: "specific" },
      { path: "/pub/mapky/", read: false, write: true, scope: "specific" },
    ]);
  });

  it("marks broad capabilities", () => {
    const request =
      "pubkyauth://signin?caps=/:rw,/pub/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.review.capabilities).toEqual([
      { path: "/", read: true, write: true, scope: "broad" },
      { path: "/pub/", read: true, write: true, scope: "broad" },
    ]);
  });

  it("accepts capability actions allowed by the Pubky auth ABNF", () => {
    const request =
      "pubkyauth://signin?caps=/pub/file.txt:r,/pub/repeated/:rrw&relay=https://httprelay.pubky.app/inbox&secret=test-secret";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.review.capabilities).toEqual([
      { path: "/pub/file.txt", read: true, write: false, scope: "specific" },
      { path: "/pub/repeated/", read: true, write: true, scope: "specific" },
    ]);
  });

  it("accepts x-source without exposing untrusted metadata in review", () => {
    const request = `${VALID_REQUEST}&x-source=Pubky%20App`;

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(JSON.stringify(result.value.review)).not.toContain("Pubky App");
  });

  it.each([
    `${VALID_REQUEST}&relay=https://other-relay.example/inbox`,
    `${VALID_REQUEST}&secret=other-secret`,
    `${VALID_REQUEST}&caps=/pub/other/:r`,
    `${VALID_REQUEST}&x-success=https://other.example/success`,
    `${VALID_REQUEST}&x-error=https://other.example/error`,
    `${VALID_REQUEST}&x-cancel=https://other.example/cancel`,
    `${VALID_REQUEST}&x-source=one&x-source=two`,
  ])("rejects duplicate supported parameters", (request) => {
    expectError(encodeRequest(request), "duplicate_parameter");
  });

  it("rejects unsupported parameters", () => {
    expectError(encodeRequest(`${VALID_REQUEST}&x-unreviewed=true`), "unsupported_parameter");
  });

  it("rejects missing and empty d values", () => {
    expectError(undefined, "missing_d");
    expectError(null, "missing_d");
    expectError("", "missing_d");
  });

  it("rejects malformed percent encoding", () => {
    expectError("%E0%A4%A", "invalid_encoding");
  });

  it("allows encoded d at its size limit and rejects limit plus one", () => {
    const atLimit = "%41".repeat(PUBKY_AUTH_REQUEST_LIMITS.encodedDLength / 3);

    expectError(atLimit, "invalid_url");
    expectError(`${atLimit}A`, "request_too_large");
  });

  it("allows a decoded auth URL at its size limit and rejects limit plus one", () => {
    const prefix = "pubkyauth:";
    const atLimit = `${prefix}${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength - prefix.length)}`;

    expectError(encodeRequest(atLimit), "invalid_auth_request_path");
    expectError(encodeRequest(`${atLimit}a`), "request_too_large");
  });

  it("rejects unencoded values", () => {
    expectError(VALID_REQUEST, "invalid_encoding");
  });

  it("rejects decoded non-URL input", () => {
    expectError(encodeRequest("not a url"), "invalid_url");
  });

  it("rejects non-pubkyauth schemes", () => {
    expectError(encodeRequest(VALID_REQUEST.replace("pubkyauth://", "https://")), "unsupported_scheme");
    expectError(encodeRequest(VALID_REQUEST.replace("pubkyauth://", "http://")), "unsupported_scheme");
    expectError(encodeRequest(VALID_REQUEST.replace("pubkyauth://", "pubky://")), "unsupported_scheme");
  });

  it("rejects unsupported auth request paths", () => {
    expectError(encodeRequest(VALID_REQUEST.replace("pubkyauth://signin", "pubkyauth://signup")), "invalid_auth_request_path");
  });

  it("rejects missing relay", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_relay",
    );
  });

  it("rejects invalid relay URLs", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=not-a-url&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "invalid_relay",
    );

    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=http://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "invalid_relay",
    );

    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://user:password@relay.example/inbox&secret=test-secret",
      ),
      "invalid_relay",
    );
  });

  it("rejects missing secret", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_secret",
    );
  });

  it("accepts the secret length limit and rejects limit plus one", () => {
    const atLimit = "s".repeat(PUBKY_AUTH_REQUEST_LIMITS.secretLength);
    const request = `pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=${atLimit}`;

    expect(Result.isOk(parsePubkyAuthRequest(encodeRequest(request)))).toBe(true);
    expectError(encodeRequest(`${request}s`), "invalid_secret");
  });

  it("rejects missing capabilities", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_capabilities",
    );
  });

  it("rejects malformed capabilities", () => {
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "pub/pubky.app/:rw")), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "/pub/pubky.app/:admin")), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "/pub/a/:r,,/pub/b/:w")), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "/pub/my app/:rw")), "invalid_capability");
  });

  it("maps oversized capability arrays and paths to a safe error", () => {
    const tooMany = Array(PUBKY_AUTH_REQUEST_LIMITS.capabilityCount + 1).fill("/pub/app/:r").join(",");
    const longPath = `/${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.capabilityPathLength)}`;

    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", tooMany)), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", `${longPath}:r`)), "invalid_capability");
  });

  it("allows missing callbacks", () => {
    const result = parsePubkyAuthRequest(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret",
      ),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.review.callbackAvailability).toEqual({ success: false, error: false, cancel: false });
    expect(result.value.review.requestingAppDisplayName).toBeUndefined();
  });

  it("rejects mixed callback origins", () => {
    const request = VALID_REQUEST.replace(
      "https://pubky.app/passport-error",
      "https://other.example/passport-error",
    );

    expectError(encodeRequest(request), "invalid_callback");
  });

  it("derives display domain without exposing callback query parameters", () => {
    const result = parsePubkyAuthRequest(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success?token=private",
      ),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.review.requestingAppDisplayName).toBe("pubky.app");
    expect(JSON.stringify(result.value.review)).not.toContain("token=private");
  });

  it("rejects unsafe callback schemes", () => {
    for (const scheme of ["javascript:", "data:", "file:", "blob:"]) {
      expectError(
        encodeRequest(VALID_REQUEST.replace("https://pubky.app/passport-success", `${scheme}alert(1)`)),
        "invalid_callback",
      );
    }
  });
});
