import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import {
  validatePubkyAuthUrls,
  validateRelayUrl,
  type PubkyAuthUrlValidationErrorCode,
} from "./validatePubkyAuthUrls";

function authUrl(query: string): URL {
  return new URL(`pubkyauth://signin?${query}`);
}

function expectUrlError(url: URL, code: PubkyAuthUrlValidationErrorCode): void {
  const result = validatePubkyAuthUrls(url);

  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error.code).toBe(code);
    expect(result.error.message).not.toContain("secret-value");
    expect(result.error.message).not.toContain("token=private");
    expect(result.error.message).not.toContain("https://third.example/callback");
  }
}

describe("validateRelayUrl", () => {
  it("allows HTTPS relay URLs", () => {
    const result = validateRelayUrl("https://httprelay.pubky.app/inbox");

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.href).toBe("https://httprelay.pubky.app/inbox");
  });

  it("rejects missing relay URLs", () => {
    const result = validateRelayUrl(null);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("missing_relay");
    }
  });

  it("rejects relative, malformed, and non-HTTPS relay URLs", () => {
    for (const relay of ["/inbox", "not a url", "http://httprelay.pubky.app/inbox"]) {
      const result = validateRelayUrl(relay);

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.code).toBe("invalid_relay");
      }
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

  it("allows missing callbacks", () => {
    const result = validatePubkyAuthUrls(authUrl("relay=https://httprelay.pubky.app/inbox&secret=secret-value"));

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.callbacks).toEqual({});
    expect(result.value.requestingAppDisplayName).toBeUndefined();
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
    for (const callback of ["http://third.example/success", "pubky://third.example/success"]) {
      expectUrlError(
        authUrl(`relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=${callback}`),
        "invalid_callback",
      );
    }
  });

  it("allows localhost callbacks only when explicitly enabled", () => {
    for (const callback of [
      "http://localhost:3000/success",
      "http://127.0.0.1:3000/success",
      "http://[::1]:3000/success",
    ]) {
      const url = authUrl(`relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=${callback}`);

      expectUrlError(url, "invalid_callback");

      const result = validatePubkyAuthUrls(url, { allowLocalhostCallbacks: true });

      expect(Result.isOk(result)).toBe(true);
    }
  });

  it("derives display domain from x-success without query parameters", () => {
    const result = validatePubkyAuthUrls(
      authUrl(
        "relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=https://third.example/callback?token=private",
      ),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.requestingAppDisplayName).toBe("third.example");
  });

  it("derives display domain from other callbacks when x-success is absent", () => {
    const errorResult = validatePubkyAuthUrls(
      authUrl("relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-error=https://errors.example/error"),
    );

    expect(Result.isOk(errorResult)).toBe(true);
    if (Result.isError(errorResult)) {
      throw new Error(errorResult.error.code);
    }

    expect(errorResult.value.requestingAppDisplayName).toBe("errors.example");

    const cancelResult = validatePubkyAuthUrls(
      authUrl("relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-cancel=https://cancel.example/cancel"),
    );

    expect(Result.isOk(cancelResult)).toBe(true);
    if (Result.isError(cancelResult)) {
      throw new Error(cancelResult.error.code);
    }

    expect(cancelResult.value.requestingAppDisplayName).toBe("cancel.example");
  });

  it("displays internationalized callback domains as punycode ASCII to resist homograph spoofing", () => {
    // "аpple.example" uses a Cyrillic "а"; it must not be shown as the Latin look-alike.
    const result = validatePubkyAuthUrls(
      authUrl(
        "relay=https://httprelay.pubky.app/inbox&secret=secret-value&x-success=https://\u0430pple.example/success",
      ),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error(result.error.code);
    }

    expect(result.value.requestingAppDisplayName).toBe("xn--pple-43d.example");
    expect(result.value.requestingAppDisplayName).not.toContain("\u0430");
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
