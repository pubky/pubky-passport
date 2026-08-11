import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../src/libs/logger/logger";
import { config, proxy } from "../src/proxy";

describe("request CSP proxy", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/config/path");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
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

    expect(cspSources(policy, "connect-src")).toContain("https:");
    expect(policy).not.toContain("/inbox");
    expect(policy).not.toContain("sensitive-secret");
    expect(cspSources(policy, "connect-src")).toContain("https://homegate.example");
    expect(cspSources(policy, "connect-src")).toContain("https://homeserver.example");
    expect(policy).not.toContain("/config/path");
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

  it("rejects unsafe configured homeserver origins before emitting CSP", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://*.example.com");

    expect(() => proxy(new NextRequest("https://passport.example/")))
      .toThrow("PUBKY_HOMESERVER_CONNECT_ORIGINS must contain CSP-safe HTTPS origins");
    expect(error).toHaveBeenCalledWith("proxy.bootstrap.failed", {
      layer: "proxy",
      operation: "build_response_policy",
      code: "runtime_exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("https://*.example.com");
  });

});

function authorizationRequest(relay: string): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(relay)}&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8`;
}

function cspSources(policy: string | null, name: string): string[] {
  const directive = policy?.split(";").find((candidate) => candidate.trimStart().startsWith(`${name} `));
  return directive?.trim().split(/\s+/).slice(1) ?? [];
}
