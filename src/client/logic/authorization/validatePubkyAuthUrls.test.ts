import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import {
  validatePubkyAuthUrls,
  type PubkyAuthUrlValidationErrorCode,
} from "./validatePubkyAuthUrls";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

function authUrl(query: string): URL {
  return new URL(`pubkyauth://signin?${query}`);
}

function validateRelay(relay: string | null) {
  const url = authUrl("secret=secret-value");
  if (relay !== null) url.searchParams.set("relay", relay);
  return validatePubkyAuthUrls(url);
}

function expectUrlError(url: URL, code: PubkyAuthUrlValidationErrorCode): void {
  const result = validatePubkyAuthUrls(url);

  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual({ code });
  }
}

describe("validateRelayUrl", () => {
  it("allows client-provided HTTPS relay URLs", () => {
    const result = validateRelay("https://custom-relay.example/inbox?region=eu");

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.relayHost).toBe("custom-relay.example");
  });

  it("rejects missing relay URLs", () => {
    const result = validateRelay(null);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("missing_relay");
    }
  });

  it("rejects relative, malformed, non-HTTPS, credentialed, and fragmented relay URLs", () => {
    for (const relay of [
      "/inbox",
      "not a url",
      "http://httprelay.pubky.app/inbox",
      "https://user:password@relay.example/inbox",
      "https://relay.example/inbox#channel",
      "https://*/inbox",
      "https://*.example/inbox",
      "https://a;b.example/inbox",
      "https://a'b.example/inbox",
    ]) {
      const result = validateRelay(relay);

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.code).toBe("invalid_relay");
      }
    }
  });

  it("accepts the relay URL length limit and rejects limit plus one", () => {
    const prefix = "https://httprelay.pubky.app/";
    const atLimit = `${prefix}${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.relayUrlLength - prefix.length)}`;

    expect(Result.isOk(validateRelay(atLimit))).toBe(true);
    const overLimit = validateRelay(`${atLimit}a`);
    expect(Result.isError(overLimit)).toBe(true);
    if (Result.isError(overLimit)) {
      expect(overLimit.error.code).toBe("invalid_relay");
    }
  });
});

describe("validatePubkyAuthUrls", () => {
  it("allows HTTPS callbacks", () => {
    const result = validatePubkyAuthUrls(
      authUrl(
        "relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=https://third.example/success&x-error=https://third.example/error&x-cancel=https://third.example/cancel",
      ),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.callbacks).toEqual({
      success: "https://third.example/success",
      error: "https://third.example/error",
      cancel: "https://third.example/cancel",
    });
  });

  it("requires every present callback to share one origin", () => {
    expectUrlError(
      authUrl(
        "relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=https://third.example/success&x-error=https://other.example/error",
      ),
      "invalid_callback",
    );
    expectUrlError(
      authUrl(
        "relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=https://third.example/success&x-cancel=https://other.example/cancel",
      ),
      "invalid_callback",
    );
  });

  it("accepts the callback URL length limit and rejects limit plus one", () => {
    const prefix = "https://third.example/";
    const atLimit = `${prefix}${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.callbackUrlLength - prefix.length)}`;
    const accepted = validatePubkyAuthUrls(
      authUrl(`relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=${atLimit}`),
    );

    expect(Result.isOk(accepted)).toBe(true);
    expectUrlError(
      authUrl(`relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=${atLimit}a`),
      "invalid_callback",
    );
  });

  it("allows missing callbacks", () => {
    const result = validatePubkyAuthUrls(authUrl("relay=https://httprelay.pubky.app/inbox&secret=secret-value"));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.callbacks).toEqual({});
  });

  it("uses legacy callback only when x-success is absent", () => {
    const legacy = validatePubkyAuthUrls(authUrl(
      `relay=https://httprelay.pubky.app/inbox&callback=${encodeURIComponent("https://third.example/success?nonce=legacy")}`,
    ));
    const canonical = validatePubkyAuthUrls(authUrl(
      `relay=https://httprelay.pubky.app/inbox&x-success=&callback=${encodeURIComponent("https://third.example/legacy")}`,
    ));

    if (Result.isError(legacy) || Result.isError(canonical)) throw new Error("callbacks must parse");
    expect(legacy.value.callbacks.success).toBe("https://third.example/success?nonce=legacy");
    expect(canonical.value.callbacks.success).toBeUndefined();
  });

  it("decodes callbacks exactly once and preserves literal plus signs", () => {
    const callback = "https%3A%2F%2Fthird.example%2Fsuccess%3Fnonce%3Da+b%26nested%3D%252Fvalue";

    const result = validatePubkyAuthUrls(authUrl(
      `relay=https://httprelay.pubky.app/inbox&x-success=${callback}`,
    ));

    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.callbacks.success).toBe("https://third.example/success?nonce=a+b&nested=%2Fvalue");
  });

  it("returns the normalized client-provided relay host", () => {
    const result = validatePubkyAuthUrls(
      authUrl("relay=https://custom-relay.example:443/inbox&secret=secret-value"),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.relayHost).toBe("custom-relay.example");
  });

  it("rejects unsafe callback schemes", () => {
    for (const scheme of ["javascript:", "data:", "file:", "blob:"]) {
      expectUrlError(
        authUrl(
          `relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=${scheme}alert(1)`,
        ),
        "invalid_callback",
      );
    }
  });

  it("rejects other non-HTTPS callback schemes by default", () => {
    for (const callback of [
      "http://third.example/success",
      "pubky://third.example/success",
    ]) {
      expectUrlError(
        authUrl(`relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=${callback}`),
        "invalid_callback",
      );
    }
  });

  it("does not expose callback query parameters in validation errors", () => {
    expectUrlError(
      authUrl(
        "relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=http://third.example/callback?token=private",
      ),
      "invalid_callback",
    );
  });
});
