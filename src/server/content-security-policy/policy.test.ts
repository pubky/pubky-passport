import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "../../libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT } from "../../libs/authorization/earlyGoogleOAuthResponse";

import { createContentSecurityPolicy } from "./policy";

const HOMEGATE_ORIGIN = "https://homegate.example";
const HOMESERVER_ORIGINS = ["https://homeserver.example"];

describe("content security policy", () => {
  it("uses a strict production nonce and allows SDK-selected HTTPS relays on authorization documents", () => {
    const policy = createContentSecurityPolicy({
      nonce: "request-nonce",
      development: false,
      homegateOrigin: HOMEGATE_ORIGIN,
      homeserverConnectOrigins: HOMESERVER_ORIGINS,
      allowPubkyAuthRelays: true,
    });
    const directives = parseCsp(policy);

    expect(directives.get("script-src")).toEqual([
      "'self'",
      "'nonce-request-nonce'",
      `'sha256-${createHash("sha256").update(EARLY_AUTHORIZATION_LOCATION_SCRIPT).digest("base64")}'`,
      `'sha256-${createHash("sha256").update(EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT).digest("base64")}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      "https://accounts.google.com",
    ]);
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
    expect(directives.get("connect-src")).toEqual(expect.arrayContaining([
      "'self'",
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      "https://homegate.example",
      "https://homeserver.example",
      "https:",
    ]));
    expect(policy).not.toContain("/inbox");
    expect(policy).not.toContain("sensitive-secret");
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
  });

  it("allows only configured homeserver origins without a global relay", () => {
    const directives = parseCsp(createContentSecurityPolicy({
      nonce: "request-nonce",
      development: false,
      homegateOrigin: HOMEGATE_ORIGIN,
      homeserverConnectOrigins: HOMESERVER_ORIGINS,
    }));

    expect(directives.get("connect-src")).not.toContain("https://httprelay.pubky.app");
    expect(directives.get("connect-src")).toContain("https://homeserver.example");
    expect(directives.get("connect-src")).not.toContain("https:");
    expect(directives.get("connect-src")).not.toContain("*");
    expect(directives.get("connect-src")).toContain("https://homegate.example");
  });

  it("adds unsafe-eval only for React development tooling", () => {
    const directives = parseCsp(createContentSecurityPolicy({
      nonce: "request-nonce",
      development: true,
      homegateOrigin: HOMEGATE_ORIGIN,
      homeserverConnectOrigins: HOMESERVER_ORIGINS,
    }));

    expect(directives.get("script-src")).toContain("'unsafe-eval'");
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
  });
});

function parseCsp(value: string): Map<string, string[]> {
  return new Map(value.split(";").map((directive) => {
    const [name, ...tokens] = directive.trim().split(/\s+/);
    if (!name) throw new Error("Invalid CSP directive");
    return [name, tokens];
  }));
}
