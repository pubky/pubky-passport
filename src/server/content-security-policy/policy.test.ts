import { describe, expect, it } from "vitest";

import { createContentSecurityPolicy, parseBrowserConnectOrigins } from "./policy";

describe("content security policy", () => {
  it("uses a strict production nonce while allowing required Pubky and Google connections", () => {
    const directives = parseCsp(createContentSecurityPolicy({
      nonce: "request-nonce",
      development: false,
      httpRelayUrl: "https://relay.example/inbox",
      browserConnectOrigins: "https://homeserver.example,https://homeserver.example:443",
    }));

    expect(directives.get("script-src")).toEqual([
      "'self'",
      "'nonce-request-nonce'",
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      "https://accounts.google.com",
      "https://apis.google.com",
    ]);
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
    expect(directives.get("connect-src")).toEqual(expect.arrayContaining([
      "'self'",
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      "https://homeserver.example",
      "https://relay.example",
    ]));
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
  });

  it("adds unsafe-eval only for React development tooling", () => {
    const directives = parseCsp(createContentSecurityPolicy({
      nonce: "request-nonce",
      development: true,
    }));

    expect(directives.get("script-src")).toContain("'unsafe-eval'");
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("accepts only exact HTTPS browser connection origins", () => {
    expect(parseBrowserConnectOrigins("https://homeserver.example,https://homeserver.example:443")).toEqual([
      "https://homeserver.example",
    ]);

    for (const value of [
      "https://*.example.com",
      "https://*",
      "https://user@example.com",
      "https://example.com/path",
      "http://example.com",
      "not a URL",
      "https://example.com,",
    ]) {
      expect(() => parseBrowserConnectOrigins(value)).toThrow("Invalid PUBKY_BROWSER_CONNECT_ORIGINS");
    }
  });
});

function parseCsp(value: string): Map<string, string[]> {
  return new Map(value.split(";").map((directive) => {
    const [name, ...tokens] = directive.trim().split(/\s+/);
    if (!name) throw new Error("Invalid CSP directive");
    return [name, tokens];
  }));
}
