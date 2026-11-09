import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "./libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "./libs/authorization/earlyGoogleImplicitResponse";
import { LOGGER, safeErrorLogFields } from "./libs/logger/logger";
import { getAppleEnvironment, getPublicEnvironment } from "./server/environment";

const EARLY_AUTHORIZATION_LOCATION_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_AUTHORIZATION_LOCATION_SCRIPT)
  .digest("base64")}'`;
const EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT)
  .digest("base64")}'`;
/**
 * Allows user-selected HTTPS relays without allowing arbitrary cross-origin WebSockets.
 * CSP's `https:` scheme source does not match `wss:`; `'self'` still covers same-origin WSS.
 */
const AUTHORIZATION_RELAY_CONNECT_SOURCE = "https:";
/**
 * Added to every page while Apple login is on: client-side navigation keeps the first page's
 * policy, so a visit that starts on a legal page and moves to sign-in needs it too. Apple's
 * sign-in pages run in popups and answer with postMessage, which CSP does not govern, and no
 * Apple script loads, so the CloudKit web API host is the only addition.
 */
const APPLE_CONNECT_SOURCES = ["https://api.apple-cloudkit.com"];

export function proxy(request: NextRequest) {
  try {
    const environment = getPublicEnvironment();
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const contentSecurityPolicy = createContentSecurityPolicy({
      nonce,
      development: process.env.NODE_ENV === "development",
      homegateOrigin: environment.homegateOrigin,
      homeserverConnectOrigins: environment.homeserverConnectOrigins,
      ...(request.nextUrl.pathname === "/authorize" ? { allowPubkyAuthRelays: true } : {}),
      allowApple: getAppleEnvironment() !== null,
    });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
  } catch (e) {
    LOGGER.error("proxy.bootstrap.failed", {
      layer: "proxy",
      operation: "build_response_policy",
      code: "runtime_exception",
      ...safeErrorLogFields(e),
    });
    throw new Error("Proxy configuration unavailable.", { cause: e });
  }
}

function createContentSecurityPolicy(input: {
  nonce: string;
  development: boolean;
  homegateOrigin: string;
  homeserverConnectOrigins: readonly string[];
  allowPubkyAuthRelays?: boolean;
  allowApple?: boolean;
}): string {
  const scriptSource = [
    "script-src 'self'",
    `'nonce-${input.nonce}'`,
    EARLY_AUTHORIZATION_LOCATION_SCRIPT_SOURCE,
    EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT_SOURCE,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    ...(input.development ? ["'unsafe-eval'"] : []),
  ].join(" ");
  return [
    "default-src 'self'",
    scriptSource,
    [
      "connect-src 'self'",
      "https://openidconnect.googleapis.com",
      "https://www.googleapis.com",
      "https://lh3.googleusercontent.com",
      input.homegateOrigin,
      ...input.homeserverConnectOrigins,
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      ...(input.allowPubkyAuthRelays ? [AUTHORIZATION_RELAY_CONNECT_SOURCE] : []),
      ...(input.allowApple ? APPLE_CONNECT_SOURCES : []),
    ].join(" "),
    "img-src 'self' data: https://lh3.googleusercontent.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ].join("; ");
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
