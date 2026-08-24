import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "./libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "./libs/authorization/earlyGoogleImplicitResponse";
import { LOGGER } from "./libs/logger/logger";
import { getApplicationEnvironment } from "./server/config/applicationEnvironment";

const EARLY_AUTHORIZATION_LOCATION_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_AUTHORIZATION_LOCATION_SCRIPT)
  .digest("base64")}'`;
const EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT)
  .digest("base64")}'`;

export function proxy(request: NextRequest) {
  try {
    const environment = getApplicationEnvironment();
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const contentSecurityPolicy = createContentSecurityPolicy({
      nonce,
      development: process.env.NODE_ENV === "development",
      homegateOrigin: environment.homegateOrigin,
      homeserverConnectOrigins: environment.homeserverConnectOrigins,
      ...(request.nextUrl.pathname === "/authorize"
        ? { allowPubkyAuthRelays: true }
        : {}),
    });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
  } catch {
    LOGGER.error("proxy.bootstrap.failed", {
      layer: "proxy",
      operation: "build_response_policy",
      code: "runtime_exception",
    });
    throw new Error("Proxy configuration unavailable.");
  }
}

function createContentSecurityPolicy(input: {
  nonce: string;
  development: boolean;
  homegateOrigin: string;
  homeserverConnectOrigins: readonly string[];
  allowPubkyAuthRelays?: boolean;
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
      ...(input.allowPubkyAuthRelays ? ["https:"] : []),
    ].join(" "),
    "img-src 'self' data:",
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
  matcher: [{
    source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};
