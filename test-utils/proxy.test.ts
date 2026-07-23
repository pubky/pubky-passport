import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "../proxy";

describe("request CSP proxy", () => {
  it("allows only the validated relay origin on an authorization document", () => {
    const request = authorizationRequest("https://relay.client.example/inbox?region=eu");

    const response = proxy(new NextRequest(`https://passport.example/authorize?d=${encodeURIComponent(request)}`));
    const policy = response.headers.get("Content-Security-Policy") ?? "";

    expect(policy).toContain("https://relay.client.example");
    expect(policy).not.toContain("/inbox");
    expect(policy).not.toContain("sensitive-secret");
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
});

function authorizationRequest(relay: string): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(relay)}&secret=sensitive-secret`;
}

function cspSources(policy: string | null, name: string): string[] {
  const directive = policy?.split(";").find((candidate) => candidate.trimStart().startsWith(`${name} `));
  return directive?.trim().split(/\s+/).slice(1) ?? [];
}
