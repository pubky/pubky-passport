import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import {
  parseEncodedPubkyAuthRequest,
  PUBKY_AUTH_REQUEST_LIMITS,
  validateEncodedPubkyAuthRequest,
  type PubkyAuthParseError,
} from "./pubkyAuthRequestParser";

const VALID_REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";
const ENCRYPTION_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SIGNED_APPROVAL_REQUEST = `pubkyauth://signin_grant?caps=/priv/chat/v1/:rwe&relay=https://relay.example/inbox&cid=chat.example&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&af=v1&epk=${ENCRYPTION_PUBLIC_KEY}`;
const PUBKY_SDK_V0_10_COMPATIBILITY_FIXTURES = [
  {
    authenticationMethod: "cookie",
    request:
      "pubkyauth://signin?caps=/pub/passport.test/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
  },
  {
    authenticationMethod: "grant",
    request:
      "pubkyauth://signin_grant?caps=/pub/passport.test/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&cid=passport.test&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
  },
] as const;
type PubkyAuthParseErrorCode = PubkyAuthParseError["code"];

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
      authenticationMethod: "cookie",
      capabilities: [
        {
          path: "/pub/pubky.app/",
          read: true,
          write: true,
          encrypt: false,
        },
      ],
      callbacks: {
        success: "https://pubky.app/passport-success",
        error: "https://pubky.app/passport-error",
        cancel: "https://pubky.app/passport-cancel",
      },
      sensitivePubkyAuthUrl: VALID_REQUEST,
    });
  });

  it("parses and normalizes the SDK x-source name", () => {
    const request = `${VALID_REQUEST}&x-source=${encodeURIComponent("  Cafe\u0301 + App  ")}`;
    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.source).toBe("Café + App");
    expect(result.value.sensitivePubkyAuthUrl).toBe(request);
  });

  it("preserves a literal plus while decoding an x-source percent-encoded space", () => {
    const request = `${VALID_REQUEST}&x-source=Bitkit+Wallet%20Mobile`;
    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.source).toBe("Bitkit+Wallet Mobile");
  });

  it.each(["Trusted%0AApp", "Trusted%E2%80%AEApp"])(
    "rejects an unsafe x-source display name: %s",
    (source) => {
      expectError(encodeRequest(`${VALID_REQUEST}&x-source=${source}`), "invalid_source");
    },
  );
  it("parses the documented pubkyauth:/// form", () => {
    const request =
      "pubkyauth:///?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.authenticationMethod).toBe("cookie");
  });

  it("parses the v0.10 grant signin intent and required PoP parameters", () => {
    const request = VALID_REQUEST.replace("pubkyauth://signin", "pubkyauth://signin_grant").replace(
      "&x-success=",
      "&cid=pubky.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&x-success=",
    );

    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.authenticationMethod).toBe("grant");
    expect(result.value).not.toHaveProperty("clientId");
  });

  it("parses HPKE signed approvals without requiring a shared secret", () => {
    const result = parseEncodedPubkyAuthRequest(encodeRequest(SIGNED_APPROVAL_REQUEST));

    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.authenticationMethod).toBe("grant");
    expect(result.value.capabilities).toEqual([
      { path: "/priv/chat/v1/", read: true, write: true, encrypt: true },
    ]);
    expect(result.value.sensitivePubkyAuthUrl).toBe(SIGNED_APPROVAL_REQUEST);
  });

  it.each(["/priv/chat/:rw", "/pub/chat/:e", ""])(
    "accepts signed approval format with capabilities %s",
    (capabilities) => {
      const request = SIGNED_APPROVAL_REQUEST.replace("/priv/chat/v1/:rwe", capabilities);
      expect(Result.isOk(parseEncodedPubkyAuthRequest(encodeRequest(request)))).toBe(true);
    },
  );

  it("preserves the exact decoded capability bytes and original URL", () => {
    const capabilities = "/priv/cafe\u0301/:rwe,/priv/café/:e";
    const request = SIGNED_APPROVAL_REQUEST.replace(
      "/priv/chat/v1/:rwe",
      encodeURIComponent(capabilities),
    );
    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.capabilities.map(({ path }) => path)).toEqual([
      "/priv/cafe\u0301/",
      "/priv/café/",
    ]);
    expect(result.value.sensitivePubkyAuthUrl).toBe(request);
  });

  it.each(["v2", "", "V1", "v1%20"])("rejects unsupported approval format %s", (format) => {
    expectError(
      encodeRequest(SIGNED_APPROVAL_REQUEST.replace("af=v1", `af=${format}`)),
      "unsupported_approval_format",
    );
  });

  it("requires an HPKE recipient key for signed approvals", () => {
    expectError(
      encodeRequest(SIGNED_APPROVAL_REQUEST.replace(`&epk=${ENCRYPTION_PUBLIC_KEY}`, "")),
      "missing_encryption_public_key",
    );
  });

  it.each([
    "",
    "short",
    `${ENCRYPTION_PUBLIC_KEY}=`,
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+",
    "A".repeat(44),
  ])("rejects noncanonical HPKE recipient keys: %s", (epk) => {
    expectError(
      encodeRequest(SIGNED_APPROVAL_REQUEST.replace(ENCRYPTION_PUBLIC_KEY, epk)),
      "invalid_encryption_public_key",
    );
  });

  it.each(["", "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8"])(
    "rejects shared secrets on signed approval requests: %s",
    (secret) => {
      expectError(
        encodeRequest(`${SIGNED_APPROVAL_REQUEST}&secret=${secret}`),
        "invalid_approval_transport",
      );
    },
  );

  it("rejects an HPKE key alongside a legacy shared secret", () => {
    expectError(
      encodeRequest(`${grantRequest("chat.example")}&epk=${ENCRYPTION_PUBLIC_KEY}`),
      "invalid_approval_transport",
    );
  });

  it("accepts HPKE bare grants without permitting encryption-key delivery", () => {
    const request = SIGNED_APPROVAL_REQUEST.replace("&af=v1", "").replace(":rwe", ":rw");
    const result = parseEncodedPubkyAuthRequest(encodeRequest(request));

    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.capabilities).toEqual([
      { path: "/priv/chat/v1/", read: true, write: true, encrypt: false },
    ]);
    expect(result.value.sensitivePubkyAuthUrl).toBe(request);
    expectError(
      encodeRequest(SIGNED_APPROVAL_REQUEST.replace("&af=v1", "")),
      "encryption_requires_signed_approval",
    );
  });

  it.each([VALID_REQUEST, grantRequest("chat.example")])(
    "rejects encryption keys on legacy requests without signed approval format",
    (request) => {
      expectError(
        encodeRequest(request.replace("/pub/pubky.app/:rw", "/pub/pubky.app/:rwe")),
        "encryption_requires_signed_approval",
      );
    },
  );

  it.each(["af=v1", `epk=${ENCRYPTION_PUBLIC_KEY}`, `af=v1&epk=${ENCRYPTION_PUBLIC_KEY}`])(
    "rejects grant approval parameters on cookie requests: %s",
    (parameters) => {
      expectError(encodeRequest(`${VALID_REQUEST}&${parameters}`), "unsupported_parameter");
    },
  );

  it.each([
    "&af=v1",
    "&af=v2",
    `&epk=${ENCRYPTION_PUBLIC_KEY}`,
    "&cid=other.example",
    "&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
    "&%61f=v1",
    `&e%70k=${ENCRYPTION_PUBLIC_KEY}`,
  ])("rejects duplicate grant and signed-approval parameters: %s", (duplicate) => {
    expectError(encodeRequest(`${SIGNED_APPROVAL_REQUEST}${duplicate}`), "duplicate_parameter");
  });

  it("keeps signup-grant requests unsupported", () => {
    expectError(
      encodeRequest(SIGNED_APPROVAL_REQUEST.replace("signin_grant", "signup_grant")),
      "invalid_auth_request_path",
    );
  });

  it.each([
    `${VALID_REQUEST}&relay=https://other-relay.example/inbox`,
    `${VALID_REQUEST}&secret=other-secret`,
    `${VALID_REQUEST}&caps=/pub/other/:r`,
    `${VALID_REQUEST}&x-success=https://other.example/success`,
    `${VALID_REQUEST}&x-error=https://other.example/error`,
    `${VALID_REQUEST}&x-cancel=https://other.example/cancel`,
    `${VALID_REQUEST}&x-source=One&x-source=Two`,
    `${VALID_REQUEST}&callback=https://pubky.app/one&callback=https://pubky.app/two`,
  ])("rejects duplicate supported parameters", (request) => {
    expectError(encodeRequest(request), "duplicate_parameter");
  });

  it("rejects unsupported parameters", () => {
    expectError(encodeRequest(`${VALID_REQUEST}&x-unreviewed=true`), "unsupported_parameter");
  });
  it("rejects oversized x-source values", () => {
    expectError(
      encodeRequest(
        `${VALID_REQUEST}&x-source=${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.maximumSourceCodeUnits + 1)}`,
      ),
      "invalid_source",
    );
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
    const atLimit = "%41".repeat(PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits / 3);

    expectError(atLimit, "invalid_url");
    expectError(`${atLimit}A`, "request_too_large");
  });

  it("allows a decoded auth URL at its size limit and rejects limit plus one", () => {
    const prefix = "pubkyauth:";
    const atLimit = `${prefix}${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.maximumDecodedAuthUrlCodeUnits - prefix.length)}`;

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
    expectError(
      encodeRequest(VALID_REQUEST.replace("pubkyauth://", "https://")),
      "unsupported_scheme",
    );
    expectError(
      encodeRequest(VALID_REQUEST.replace("pubkyauth://", "http://")),
      "unsupported_scheme",
    );
    expectError(
      encodeRequest(VALID_REQUEST.replace("pubkyauth://", "pubky://")),
      "unsupported_scheme",
    );
  });

  it("rejects unsupported auth request paths", () => {
    expectError(
      encodeRequest(VALID_REQUEST.replace("pubkyauth://signin", "pubkyauth://signup")),
      "invalid_auth_request_path",
    );
  });

  it("rejects missing relay", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_relay",
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
    const request =
      "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=";

    expectError(encodeRequest(`${request}short`), "invalid_secret");
    expectError(
      encodeRequest(
        `${request}${"s".repeat(PUBKY_AUTH_REQUEST_LIMITS.maximumSecretCodeUnits + 1)}`,
      ),
      "invalid_secret",
    );
    expectError(
      encodeRequest(`${request}kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse9`),
      "invalid_secret",
    );
  });

  it("rejects missing capabilities", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_capabilities",
    );
  });

  it("maps capability validation failures to one safe parser error", () => {
    expectError(
      encodeRequest(VALID_REQUEST.replace("/pub/pubky.app/:rw", "/pub/pubky.app/:admin")),
      "invalid_capability",
    );
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
    const request =
      "pubkyauth://signin?caps=&relay=https://httprelay.pubky.app/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

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
    const request = VALID_REQUEST.replace("pubkyauth://signin", "pubkyauth://signin_grant").replace(
      "&x-success=",
      `${grantParameters}&x-success=`,
    );

    expectError(encodeRequest(request), code);
  });

  it("bounds grant client IDs by UTF-8 length", () => {
    const atLimit = `${"ü".repeat(126)}a`;

    expect(Result.isOk(parseEncodedPubkyAuthRequest(encodeRequest(grantRequest(atLimit))))).toBe(
      true,
    );
    expectError(encodeRequest(grantRequest(`${atLimit}a`)), "invalid_client_id");
  });
});

describe("validateEncodedPubkyAuthRequest", () => {
  it("returns only success without constructing request authority", () => {
    const result = validateEncodedPubkyAuthRequest(encodeRequest(VALID_REQUEST));

    expect(Result.isOk(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8");
  });

  it("returns only a safe error code for invalid input", () => {
    const secret = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
    const result = validateEncodedPubkyAuthRequest(
      encodeRequest(`pubkyauth://signin?secret=${secret}`),
    );

    expect(Result.isError(result) && result.error).toEqual({ code: "missing_relay" });
    if (Result.isOk(result)) throw new Error("Expected validation to fail");
    expect(result.error).not.toHaveProperty("cause");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

function grantRequest(clientId: string): string {
  return VALID_REQUEST.replace("pubkyauth://signin", "pubkyauth://signin_grant").replace(
    "&x-success=",
    `&cid=${encodeURIComponent(clientId)}&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&x-success=`,
  );
}
