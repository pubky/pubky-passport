import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "../src/libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "../src/libs/authorization/earlyGoogleImplicitResponse";
import { LOGGER } from "../src/libs/logger/logger";
import { config, proxy } from "../src/proxy";

describe("request CSP proxy", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/config/path");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the configured matcher to exclude API and framework asset requests", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/authorize" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/wrapping-key/google" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/_next/static/app.js" })).toBe(false);
  });

  it("allows SDK-selected HTTPS relays only on authorization documents", () => {
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
    expect(cspSources(policy, "connect-src")).toContain("https:");
    expect(cspSources(policy, "connect-src")).toContain("https://lh3.googleusercontent.com");
    expect(cspSources(policy, "connect-src")).not.toContain("https://accounts.google.com");
    expect(cspSources(policy, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(cspSources(policy, "frame-src")).toEqual(["'none'"]);
    expect(cspSources(policy, "form-action")).toEqual(["'self'"]);
    expect(cspSources(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(cspSources(policy, "object-src")).toEqual(["'none'"]);
    expect(policy).not.toContain("/inbox");
    expect(policy).not.toContain("sensitive-secret");
    expect(cspSources(policy, "connect-src")).toContain("https://homegate.example");
    expect(cspSources(policy, "connect-src")).toContain("https://homeserver.example");
    expect(policy).not.toContain("/config/path");
  });

  it("normalizes and deduplicates configured homeserver origins", () => {
    vi.stubEnv(
      "PUBKY_HOMESERVER_CONNECT_ORIGINS",
      "https://homeserver.example/, https://migrated.example, https://homeserver.example",
    );

    const response = proxy(new NextRequest("https://passport.example/"));
    const connectSources = cspSources(response.headers.get("Content-Security-Policy"), "connect-src");

    expect(connectSources.filter((source) => source === "https://homeserver.example")).toHaveLength(1);
    expect(connectSources).toContain("https://migrated.example");
    expect(connectSources).not.toContain("https:");
    expect(connectSources).not.toContain("*");
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
    const otherRoute = proxy(new NextRequest(`https://passport.example/?d=${request}`));
    const authorization = proxy(new NextRequest(`https://passport.example/authorize?d=${request}`));

    expect(cspSources(otherRoute.headers.get("Content-Security-Policy"), "connect-src")).not.toContain("https:");
    expect(cspSources(authorization.headers.get("Content-Security-Policy"), "connect-src")).toContain("https:");
    expect(authorization.headers.get("Content-Security-Policy")).not.toContain("https://attacker.example");
    expect(authorization.headers.get("Content-Security-Policy")).not.toContain("sensitive-secret");
  });

  it("rejects unsafe configured Homegate origins before emitting CSP", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("HOMEGATE_URL", "https://*.example.com");

    expect(() => proxy(new NextRequest("https://passport.example/")))
      .toThrow("HOMEGATE_URL must be a CSP-safe HTTPS base URL");
    expect(error).toHaveBeenCalledWith("proxy.bootstrap.failed", {
      layer: "proxy",
      operation: "build_response_policy",
      code: "runtime_exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("https://*.example.com");
  });

  it.each([
    "http://homeserver.example",
    "https://user:password@homeserver.example",
    "https://homeserver.example/path",
    "https://*.example.com",
    "https://home;server.example",
    "https://192.0.2.1",
    "https://homeserver.example,,https://other.example",
    Array.from({ length: 17 }, (_, index) => `https://homeserver-${index}.example`).join(","),
  ])("rejects unsafe configured homeserver origins before emitting CSP: %s", (origins) => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", origins);

    expect(() => proxy(new NextRequest("https://passport.example/")))
      .toThrow("PUBKY_HOMESERVER_CONNECT_ORIGINS must contain CSP-safe HTTPS origins");
    expect(error).toHaveBeenCalledWith("proxy.bootstrap.failed", {
      layer: "proxy",
      operation: "build_response_policy",
      code: "runtime_exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(origins);
  });

});

function authorizationRequest(relay: string): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(relay)}&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8`;
}

function cspSources(policy: string | null, name: string): string[] {
  const directive = policy?.split(";").find((candidate) => candidate.trimStart().startsWith(`${name} `));
  return directive?.trim().split(/\s+/).slice(1) ?? [];
}
