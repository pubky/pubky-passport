import { describe, expect, it } from "vitest";

import { createContentSecurityPolicy } from "./policy";

describe("content security policy", () => {
  it("uses a strict production nonce while allowing the request's validated relay origin", () => {
    const policy = createContentSecurityPolicy({
      nonce: "request-nonce",
      development: false,
      authorizationRequestSearch: authorizationSearch("https://relay.client.example/inbox?region=eu"),
    });
    const directives = parseCsp(policy);

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
      "https://relay.client.example",
    ]));
    expect(policy).not.toContain("/inbox");
    expect(policy).not.toContain("sensitive-secret");
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
  });

  it("does not allow a relay for invalid authorization requests", () => {
    for (const request of [
      "?d=not-encoded",
      authorizationSearch("http://relay.client.example/inbox"),
      authorizationSearch("https://user:password@relay.client.example/inbox"),
      authorizationSearch("https://*/inbox"),
      authorizationSearch("https://a;b.example/inbox"),
      `?d=${encodeURIComponent("pubkyauth://signin?relay=https://relay.client.example/inbox&secret=sensitive-secret")}`,
    ]) {
      const directives = parseCsp(createContentSecurityPolicy({
        nonce: "request-nonce",
        development: false,
        authorizationRequestSearch: request,
      }));

      expect(directives.get("connect-src")).not.toContain("https://relay.client.example");
    }
  });

  it("does not configure a global HTTP relay or browser connection origin", () => {
    const directives = parseCsp(createContentSecurityPolicy({
      nonce: "request-nonce",
      development: false,
    }));

    expect(directives.get("connect-src")).not.toContain("https://httprelay.pubky.app");
    expect(directives.get("connect-src")).not.toContain("https://homeserver.example");
  });

  it("adds unsafe-eval only for React development tooling", () => {
    const directives = parseCsp(createContentSecurityPolicy({
      nonce: "request-nonce",
      development: true,
    }));

    expect(directives.get("script-src")).toContain("'unsafe-eval'");
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
  });
});

function authorizationSearch(relay: string): string {
  const request = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(relay)}&secret=sensitive-secret`;
  return `?d=${encodeURIComponent(request)}`;
}

function parseCsp(value: string): Map<string, string[]> {
  return new Map(value.split(";").map((directive) => {
    const [name, ...tokens] = directive.trim().split(/\s+/);
    if (!name) throw new Error("Invalid CSP directive");
    return [name, tokens];
  }));
}
