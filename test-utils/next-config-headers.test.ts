import { describe, expect, it } from "vitest";

import nextConfig from "../next.config.mjs";

describe("next config headers", () => {
  it("sets baseline security headers for every response", async () => {
    const headers = await nextConfig.headers?.();
    const globalHeaders = headers?.find((entry) => entry.source === "/:path*")?.headers ?? [];
    const csp = headerValue(globalHeaders, "Content-Security-Policy");
    const cspDirectives = parseCsp(csp);

    expect(globalHeaders).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        expect.objectContaining({ key: "Content-Security-Policy" }),
        expect.objectContaining({ key: "Permissions-Policy" }),
      ]),
    );

    expect(cspDirectives.get("default-src")).toEqual(["'self'"]);
    expect(cspDirectives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(cspDirectives.get("object-src")).toEqual(["'none'"]);
    expect(cspDirectives.get("base-uri")).toEqual(["'self'"]);
    expect(cspDirectives.get("script-src")).toEqual([
      "'self'",
      "https://accounts.google.com",
      "https://apis.google.com",
    ]);
    expect(cspDirectives.get("script-src")).not.toContain("'unsafe-inline'");
    expect(cspDirectives.get("script-src")).not.toContain("'unsafe-eval'");
    expect(cspDirectives.get("script-src")).not.toContain("*");
    expect(cspDirectives.get("connect-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
        "https://www.googleapis.com",
        "https://httprelay.pubky.app",
      ]),
    );
    expect(cspDirectives.get("connect-src")).not.toContain("*");
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("camera=()");
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("microphone=()");
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("geolocation=()");
  });

  it("sets no-store and no-referrer headers for /authorize and subpaths", async () => {
    const headers = await nextConfig.headers?.();
    const authorizeHeaders = [
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];

    expect(headers).toContainEqual({
      source: "/authorize",
      headers: authorizeHeaders,
    });
    expect(headers).toContainEqual({
      source: "/authorize/:path*",
      headers: authorizeHeaders,
    });
  });
});

function headerValue(headers: Array<{ key: string; value: string }>, key: string): string {
  const header = headers.find((entry) => entry.key === key);

  expect(header).toBeDefined();

  return header?.value ?? "";
}

function parseCsp(value: string): Map<string, string[]> {
  const directives: Array<[string, string[]]> = [];

  for (const directive of value.split(";")) {
    const [name, ...tokens] = directive.trim().split(/\s+/);
    if (name) {
      directives.push([name, tokens]);
    }
  }

  return new Map(directives);
}
