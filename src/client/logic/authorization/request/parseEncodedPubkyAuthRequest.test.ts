import { describe, expect, expectTypeOf, it } from "vitest";
import { Result } from "better-result";

import { parseEncodedPubkyAuthRequest, type PubkyAuthParseErrorCode } from "./parseEncodedPubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";
import type { PubkyAuthUrlValidationErrorCode } from "./validatePubkyAuthUrls";

const VALID_REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";
const PUBKY_SDK_V0_10_COMPATIBILITY_FIXTURES = [
  {
    authenticationMethod: "cookie",
    request: "pubkyauth://signin?caps=/pub/passport.test/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
  },
  {
    authenticationMethod: "grant",
    request: "pubkyauth://signin_grant?caps=/pub/passport.test/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&cid=passport.test&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
  },
] as const;
expectTypeOf<PubkyAuthUrlValidationErrorCode>().toMatchTypeOf<PubkyAuthParseErrorCode>();

function encodeRequest(request: string): string {
  return encodeURIComponent(request);
}

function expectError(input: unknown, code: PubkyAuthParseErrorCode): void {
  const result = parseEncodedPubkyAuthRequest(input);

  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual({ code });
  }
}

describe("parseEncodedPubkyAuthRequest", () => {
  it.each(PUBKY_SDK_V0_10_COMPATIBILITY_FIXTURES)(
    "parses the sanitized SDK v0.10 $authenticationMethod fixture",
    ({ authenticationMethod, request }) => {
      const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

      expect(Result.isOk(result) && result.value.authenticationMethod).toBe(authenticationMethod);
    },
  );

  it("parses a valid x-callback-url Pubky auth request", () => {
    const result = parseEncodedPubkyAuthRequest(encodeRequest(VALID_REQUEST));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value).toEqual({
      kind: "signin",
      authenticationMethod: "cookie",
      capabilities: [
        {
          path: "/pub/pubky.app/",
          read: true,
          write: true,
        },
      ],
      callbacks: {
        success: "https://pubky.app/passport-success",
        error: "https://pubky.app/passport-error",
        cancel: "https://pubky.app/passport-cancel",
      },
      relayHost: "httprelay.pubky.app",
      sensitivePubkyAuthUrl: VALID_REQUEST,
    });
  });

  it("accepts a client-provided HTTPS relay", () => {
    const result = parseEncodedPubkyAuthRequest(encodeRequest(
      VALID_REQUEST.replace("https://httprelay.pubky.app/inbox", "https://relay.client.example/custom-inbox"),
    ));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.relayHost).toBe("relay.client.example");
  });

  it("parses the documented pubkyauth:/// form", () => {
    const request =
      "pubkyauth:///?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.kind).toBe("signin");
  });

  it("parses the v0.10 grant signin intent and required PoP parameters", () => {
    const request = VALID_REQUEST
      .replace("pubkyauth://signin", "pubkyauth://signin_grant")
      .replace(
        "&x-success=",
        "&cid=pubky.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&x-success=",
      );

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.authenticationMethod).toBe("grant");
    expect(result.value).not.toHaveProperty("clientId");
  });

  it("parses comma-separated capabilities", () => {
    const request =
      "pubkyauth://signin?caps=/pub/pubky.app/:rw,/pub/eventky/:r,/pub/mapky/:w&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.capabilities).toEqual([
      { path: "/pub/pubky.app/", read: true, write: true },
      { path: "/pub/eventky/", read: true, write: false },
      { path: "/pub/mapky/", read: false, write: true },
    ]);
  });

  it("accepts capability actions allowed by the Pubky auth ABNF", () => {
    const request =
      "pubkyauth://signin?caps=/pub/file.txt:r,/pub/repeated/:rrw&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.capabilities).toEqual([
      { path: "/pub/file.txt", read: true, write: false },
      { path: "/pub/repeated/", read: true, write: true },
    ]);
  });

  it("accepts x-source without exposing untrusted metadata in review", () => {
    const request = `${VALID_REQUEST}&x-source=Pubky%20App`;

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(JSON.stringify(result.value)).not.toContain("Pubky App");
  });

  it.each([
    `${VALID_REQUEST}&relay=https://other-relay.example/inbox`,
    `${VALID_REQUEST}&secret=other-secret`,
    `${VALID_REQUEST}&caps=/pub/other/:r`,
    `${VALID_REQUEST}&x-success=https://other.example/success`,
    `${VALID_REQUEST}&x-error=https://other.example/error`,
    `${VALID_REQUEST}&x-cancel=https://other.example/cancel`,
    `${VALID_REQUEST}&x-source=one&x-source=two`,
    `${VALID_REQUEST}&callback=https://pubky.app/one&callback=https://pubky.app/two`,
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
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_relay",
    );
  });

  it("rejects invalid relay URLs", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=not-a-url&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "invalid_relay",
    );

    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=http://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "invalid_relay",
    );

    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://user:password@relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
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

  it("requires the canonical unpadded base64url encoding of a 32-byte secret", () => {
    const request = "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=";

    expectError(encodeRequest(`${request}short`), "invalid_secret");
    expectError(encodeRequest(`${request}${"s".repeat(PUBKY_AUTH_REQUEST_LIMITS.secretLength + 1)}`), "invalid_secret");
    expectError(encodeRequest(`${request}kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse9`), "invalid_secret");
  });

  it("rejects missing capabilities", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_capabilities",
    );
  });

  it("rejects malformed capabilities", () => {
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "pub/pubky.app/:rw")), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "/pub/pubky.app/:admin")), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "/pub/a/:r,,/pub/b/:w")), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "/pub//app/:rw")), "invalid_capability");
  });

  it("maps oversized capability arrays and paths to a safe error", () => {
    const tooMany = Array(PUBKY_AUTH_REQUEST_LIMITS.capabilityCount + 1).fill("/pub/app/:r").join(",");
    const longPath = `/${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.capabilityPathLength)}`;

    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", tooMany)), "invalid_capability");
    expectError(encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", `${longPath}:r`)), "invalid_capability");
  });

  it("allows missing callbacks", () => {
    const result = parseEncodedPubkyAuthRequest(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
      ),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.callbacks).toEqual({});
  });

  it("accepts an explicit empty capability list", () => {
    const request = "pubkyauth://signin?caps=&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.capabilities).toEqual([]);
  });

  it.each([
    ["", "missing_client_id"],
    ["&cid=pubky.app", "missing_client_public_key"],
    ["&cid=pubky.app&cpk=not-a-public-key", "invalid_client_public_key"],
  ] as const)("rejects invalid grant parameters", (grantParameters, code) => {
    const request = VALID_REQUEST
      .replace("pubkyauth://signin", "pubkyauth://signin_grant")
      .replace("&x-success=", `${grantParameters}&x-success=`);

    expectError(encodeRequest(request), code);
  });

  it("rejects mixed callback origins", () => {
    const request = VALID_REQUEST.replace(
      "https://pubky.app/passport-error",
      "https://other.example/passport-error",
    );

    expectError(encodeRequest(request), "invalid_callback");
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
