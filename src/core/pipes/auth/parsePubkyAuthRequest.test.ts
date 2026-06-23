import { describe, expect, it } from "vitest";

import {
  parsePubkyAuthRequest,
  type PubkyAuthParseErrorCode,
} from "./parsePubkyAuthRequest";

const validRequest =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";

function encodeRequest(request: string): string {
  return encodeURIComponent(request);
}

function expectError(input: unknown, code: PubkyAuthParseErrorCode): void {
  const result = parsePubkyAuthRequest(input);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.message).not.toContain("test-secret");
  }
}

describe("parsePubkyAuthRequest", () => {
  it("parses a valid x-callback-url Pubky auth request", () => {
    const result = parsePubkyAuthRequest(encodeRequest(validRequest));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request).toEqual({
      kind: "signin",
      relay: "https://httprelay.pubky.app/inbox",
      secret: "test-secret",
      capabilities: [
        {
          path: "/pub/pubky.app/",
          read: true,
          write: true,
          scope: "specific",
        },
      ],
      callbacks: {
        success: "https://pubky.app/passport-success",
        error: "https://pubky.app/passport-error",
        cancel: "https://pubky.app/passport-cancel",
      },
      requestingAppDisplayName: "pubky.app",
    });
  });

  it("parses the documented pubkyauth:/// form", () => {
    const request =
      "pubkyauth:///?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request.kind).toBe("signin");
  });

  it("parses comma-separated capabilities", () => {
    const request =
      "pubkyauth://signin?caps=/pub/pubky.app/:rw,/pub/eventky/:r,/pub/mapky/:w&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request.capabilities).toEqual([
      { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
      { path: "/pub/eventky/", read: true, write: false, scope: "specific" },
      { path: "/pub/mapky/", read: false, write: true, scope: "specific" },
    ]);
  });

  it("marks broad capabilities", () => {
    const request =
      "pubkyauth://signin?caps=/:rw,/pub/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request.capabilities).toEqual([
      { path: "/", read: true, write: true, scope: "broad" },
      { path: "/pub/", read: true, write: true, scope: "broad" },
    ]);
  });

  it("accepts capability actions allowed by the Pubky auth ABNF", () => {
    const request =
      "pubkyauth://signin?caps=/pub/file.txt:r,/pub/repeated/:rrw&relay=https://httprelay.pubky.app/inbox&secret=test-secret";

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request.capabilities).toEqual([
      { path: "/pub/file.txt", read: true, write: false, scope: "specific" },
      { path: "/pub/repeated/", read: true, write: true, scope: "specific" },
    ]);
  });

  it("preserves optional x-source metadata", () => {
    const request = `${validRequest}&x-source=Pubky%20App`;

    const result = parsePubkyAuthRequest(encodeRequest(request));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request.source).toBe("Pubky App");
  });

  it("allows localhost callbacks only when explicitly enabled", () => {
    const request =
      "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=http://localhost:3000/passport-success&x-error=http://localhost:3000/passport-error&x-cancel=http://localhost:3000/passport-cancel";

    expectError(encodeRequest(request), "invalid_callback");

    const result = parsePubkyAuthRequest(encodeRequest(request), {
      allowLocalhostCallbacks: true,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects missing and empty d values", () => {
    expectError(undefined, "missing_d");
    expectError(null, "missing_d");
    expectError("", "missing_d");
  });

  it("rejects malformed percent encoding", () => {
    expectError("%E0%A4%A", "invalid_encoding");
  });

  it("rejects unencoded values", () => {
    expectError(validRequest, "invalid_encoding");
  });

  it("rejects decoded non-URL input", () => {
    expectError(encodeRequest("not a url"), "invalid_url");
  });

  it("rejects non-pubkyauth schemes", () => {
    expectError(encodeRequest(validRequest.replace("pubkyauth://", "https://")), "unsupported_scheme");
    expectError(encodeRequest(validRequest.replace("pubkyauth://", "http://")), "unsupported_scheme");
    expectError(encodeRequest(validRequest.replace("pubkyauth://", "pubky://")), "unsupported_scheme");
  });

  it("rejects unsupported auth request paths", () => {
    expectError(encodeRequest(validRequest.replace("pubkyauth://signin", "pubkyauth://signup")), "invalid_auth_request_path");
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
  });

  it("rejects missing secret", () => {
    expectError(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&x-success=https://pubky.app/passport-success&x-error=https://pubky.app/passport-error&x-cancel=https://pubky.app/passport-cancel",
      ),
      "missing_secret",
    );
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
    expectError(encodeRequest(validRequest.replace("/pub/pubky.app/:rw", "pub/pubky.app/:rw")), "invalid_capability");
    expectError(encodeRequest(validRequest.replace("/pub/pubky.app/:rw", "/pub/pubky.app/:admin")), "invalid_capability");
    expectError(encodeRequest(validRequest.replace("/pub/pubky.app/:rw", "/pub/a/:r,,/pub/b/:w")), "invalid_capability");
    expectError(encodeRequest(validRequest.replace("/pub/pubky.app/:rw", "/pub/my app/:rw")), "invalid_capability");
  });

  it("allows missing callbacks", () => {
    const result = parsePubkyAuthRequest(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret",
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request.callbacks).toEqual({});
    expect(result.request.requestingAppDisplayName).toBeUndefined();
  });

  it("derives display domain without exposing callback query parameters", () => {
    const result = parsePubkyAuthRequest(
      encodeRequest(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=test-secret&x-success=https://pubky.app/passport-success?token=private",
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.request.requestingAppDisplayName).toBe("pubky.app");
  });

  it("rejects unsafe callback schemes", () => {
    for (const scheme of ["javascript:", "data:", "file:", "blob:"]) {
      expectError(
        encodeRequest(validRequest.replace("https://pubky.app/passport-success", `${scheme}alert(1)`)),
        "invalid_callback",
      );
    }
  });
});
