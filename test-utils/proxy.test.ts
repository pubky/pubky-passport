import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "../proxy";

describe("request CSP proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_HOMEGATE_URL", "https://homegate.example/config/path");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("allows only the validated relay origin on an authorization document", () => {
    const request = authorizationRequest("https://relay.client.example/inbox?region=eu");

    const response = proxy(new NextRequest(`https://passport.example/authorize?d=${encodeURIComponent(request)}`));
    const policy = response.headers.get("Content-Security-Policy") ?? "";

    expect(policy).toContain("https://relay.client.example");
    expect(policy).not.toContain("/inbox");
    expect(policy).not.toContain("sensitive-secret");
    expect(cspSources(policy, "connect-src")).toContain("https://homegate.example");
    expect(policy).not.toContain("/config/path");
  });

  it("does not allow request-derived origins on other routes or invalid requests", () => {
    const validRequest = encodeURIComponent(authorizationRequest("https://relay.client.example/inbox"));
    const invalidRequest = encodeURIComponent(authorizationRequest("http://relay.client.example/inbox"));
    const wildcardRequest = encodeURIComponent(authorizationRequest("https://*/inbox"));

    const otherRoute = proxy(new NextRequest(`https://passport.example/?d=${validRequest}`));
    const invalidAuthorization = proxy(new NextRequest(`https://passport.example/authorize?d=${invalidRequest}`));
    const wildcardAuthorization = proxy(new NextRequest(`https://passport.example/authorize?d=${wildcardRequest}`));

    expect(otherRoute.headers.get("Content-Security-Policy")).not.toContain("https://relay.client.example");
    expect(invalidAuthorization.headers.get("Content-Security-Policy")).not.toContain("https://relay.client.example");
    expect(cspSources(wildcardAuthorization.headers.get("Content-Security-Policy"), "connect-src")).not.toContain("https://*");
  });

  it("rejects unsafe configured Homegate origins before emitting CSP", () => {
    vi.stubEnv("NEXT_PUBLIC_HOMEGATE_URL", "https://*.example.com");

    expect(() => proxy(new NextRequest("https://passport.example/")))
      .toThrow("Invalid Homegate URL configuration.");
  });
});

function authorizationRequest(relay: string): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(relay)}&secret=sensitive-secret`;
}

function cspSources(policy: string | null, name: string): string[] {
  const directive = policy?.split(";").find((candidate) => candidate.trimStart().startsWith(`${name} `));
  return directive?.trim().split(/\s+/).slice(1) ?? [];
}
