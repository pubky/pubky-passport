import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "./libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "./libs/authorization/earlyGoogleImplicitResponse";
import { LOGGER } from "./libs/logger/logger";
import { stubPassportEnvironment } from "@test-utils/passportEnvironment";
import { config, proxy } from "./proxy";

/** `connect-src` of every page but the two signer pages: no homeserver, no relay. */
const FIXED_CONNECT_SOURCES = [
  "'self'",
  "https://openidconnect.googleapis.com",
  "https://www.googleapis.com",
  "https://lh3.googleusercontent.com",
  "https://homegate.example",
  "https://pkarr.pubky.app",
  "https://pkarr.pubky.org",
];
/** Both signer pages reach any homeserver and relay over HTTPS. */
const SIGNER_CONNECT_SOURCES = [...FIXED_CONNECT_SOURCES, "https:"];
const NARROW_IMAGE_SOURCES = ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"];
const GRANT_RELAY_URL = "https://relay.passport.example/inbox";

describe("request CSP proxy", () => {
  beforeEach(() => {
    stubPassportEnvironment();
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the configured matcher to exclude API and framework asset requests", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/authorize" })).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/wrapping-key/google" }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/_next/static/app.js" }),
    ).toBe(false);
  });

  it("allows HTTPS relays without adding cross-origin WebSocket schemes", () => {
    const response = proxy(new NextRequest("https://passport.example/authorize"));
    const policy = response.headers.get("Content-Security-Policy") ?? "";

    expect(cspSources(policy, "script-src")).toEqual([
      "'self'",
      expect.stringMatching(/^'nonce-[A-Za-z0-9+/]+=*'$/u),
      `'sha256-${createHash("sha256").update(EARLY_AUTHORIZATION_LOCATION_SCRIPT).digest("base64")}'`,
      `'sha256-${createHash("sha256").update(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT).digest("base64")}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
    ]);
    expect(cspSources(policy, "script-src")).not.toContain("'unsafe-inline'");
    expect(cspSources(policy, "script-src")).not.toContain("'unsafe-eval'");
    expect(cspSources(policy, "connect-src")).toContain("'self'");
    expect(cspSources(policy, "connect-src")).toContain("https:");
    expect(cspSources(policy, "connect-src")).not.toContain("ws:");
    expect(cspSources(policy, "connect-src")).not.toContain("wss:");
    expect(cspSources(policy, "connect-src")).toContain("https://lh3.googleusercontent.com");
    expect(cspSources(policy, "connect-src")).not.toContain("https://accounts.google.com");
    expect(cspSources(policy, "img-src")).toEqual(NARROW_IMAGE_SOURCES);
    expect(cspSources(policy, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(cspSources(policy, "frame-src")).toEqual(["'none'"]);
    expect(cspSources(policy, "form-action")).toEqual(["'self'"]);
    expect(cspSources(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(cspSources(policy, "object-src")).toEqual(["'none'"]);
    expect(policy).not.toContain("/inbox");
    expect(policy).not.toContain("sensitive-secret");
    expect(cspSources(policy, "connect-src")).toContain("https://homegate.example");
  });

  it.each(["/", "/authorize"])(
    "lets the signer page %s reach any HTTPS homeserver or relay",
    (path) => {
      vi.stubEnv("PUBKY_HTTP_RELAY_URL", GRANT_RELAY_URL);
      const policy = proxy(new NextRequest(`https://passport.example${path}`)).headers.get(
        "Content-Security-Policy",
      );

      // `https:` covers Passport's own grant relay too, so it is not named separately.
      expect(cspSources(policy, "connect-src")).toEqual(SIGNER_CONNECT_SOURCES);
      expect(cspSources(policy, "img-src")).toEqual(NARROW_IMAGE_SOURCES);
    },
  );

  it.each(["/privacy-policy", "/terms-of-service", "/missing", "/authorize/extra", "/authorize-x"])(
    "keeps %s on the fixed origins without any homeserver or relay",
    (path) => {
      vi.stubEnv("PUBKY_HTTP_RELAY_URL", GRANT_RELAY_URL);
      const policy = proxy(new NextRequest(`https://passport.example${path}`)).headers.get(
        "Content-Security-Policy",
      );

      expect(cspSources(policy, "connect-src")).toEqual(FIXED_CONNECT_SOURCES);
      expect(cspSources(policy, "img-src")).toEqual(NARROW_IMAGE_SOURCES);
    },
  );

  it("names no Homegate origin, and no empty source, on an instance without Homegate", () => {
    stubPassportEnvironment({
      PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({
        googleEnabled: false,
        verificationMethods: ["invite"],
      }),
      HOMEGATE_URL: undefined,
    });
    for (const path of ["/", "/privacy-policy"]) {
      const policy =
        proxy(new NextRequest(`https://passport.example${path}`)).headers.get(
          "Content-Security-Policy",
        ) ?? "";

      expect(cspSources(policy, "connect-src")).not.toContain("https://homegate.example");
      expect(policy).not.toMatch(/ {2}|\s;/u);
    }
  });

  it("ignores the retired homeserver origin list", () => {
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example/path");

    const policy = proxy(new NextRequest("https://passport.example/privacy-policy")).headers.get(
      "Content-Security-Policy",
    );

    expect(cspSources(policy, "connect-src")).toEqual(FIXED_CONNECT_SOURCES);
  });

  it("builds CSP without reading server-secret configuration", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", undefined);
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", "not-json");

    expect(() => proxy(new NextRequest("https://passport.example/"))).not.toThrow();
  });

  it("adds unsafe-eval only for React development tooling", () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = proxy(new NextRequest("https://passport.example/"));
    const scriptSources = cspSources(response.headers.get("Content-Security-Policy"), "script-src");

    expect(scriptSources).toContain("'unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-inline'");
  });

  it("does not project authorization request data into CSP", () => {
    const request = encodeURIComponent(authorizationRequest("https://attacker.example/inbox"));
    for (const path of ["/", "/authorize", "/privacy-policy"]) {
      const policy =
        proxy(new NextRequest(`https://passport.example${path}?d=${request}`)).headers.get(
          "Content-Security-Policy",
        ) ?? "";

      expect(policy).not.toContain("attacker.example");
      expect(policy).not.toContain("sensitive-secret");
      expect(cspSources(policy, "connect-src")).toEqual(
        path === "/privacy-policy" ? FIXED_CONNECT_SOURCES : SIGNER_CONNECT_SOURCES,
      );
    }
  });

  it("rejects unsafe configured Homegate origins before emitting CSP", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("HOMEGATE_URL", "https://*.example.com");

    expect(() => proxy(new NextRequest("https://passport.example/"))).toThrow(
      "Proxy configuration unavailable.",
    );
    expect(error).toHaveBeenCalledWith(
      "proxy.bootstrap.failed",
      expect.objectContaining({
        layer: "proxy",
        operation: "build_response_policy",
        code: "runtime_exception",
        diagnosticId: expect.any(String),
        errorName: expect.any(String),
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("https://*.example.com");
  });
});

function authorizationRequest(relay: string): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(relay)}&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8`;
}

function cspSources(policy: string | null, name: string): string[] {
  const directive = policy
    ?.split(";")
    .find((candidate) => candidate.trimStart().startsWith(`${name} `));
  return directive?.trim().split(/\s+/).slice(1) ?? [];
}
