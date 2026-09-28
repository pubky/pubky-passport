import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "./libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "./libs/authorization/earlyGoogleImplicitResponse";
import { LOGGER, safeErrorLogFields } from "./libs/logger/logger";
import { getPublicEnvironment } from "./server/environment";

const EARLY_AUTHORIZATION_LOCATION_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_AUTHORIZATION_LOCATION_SCRIPT)
  .digest("base64")}'`;
const EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT)
  .digest("base64")}'`;
/**
 * What the two signer pages add to `connect-src`. A person may sign up on any homeserver they hold
 * an invite for, an identity lives on whichever homeserver its key's PKARR record names (at run
 * time, including a port), and a request brings its own relay, so these pages reach any HTTPS
 * origin. CSP's `https:` scheme source does not match `wss:`; `'self'` still covers same-origin WSS.
 */
const SIGNER_CONNECT_SOURCE = "https:";
/** `/authorize` reviews requests and `/` manages identities; both use homeservers and relays. */
const SIGNER_PATHS: ReadonlySet<string> = new Set(["/", "/authorize"]);

export function proxy(request: NextRequest) {
  try {
    const environment = getPublicEnvironment();
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const contentSecurityPolicy = createContentSecurityPolicy({
      nonce,
      development: process.env.NODE_ENV === "development",
      homegateOrigin: environment.homegateOrigin,
      signer: SIGNER_PATHS.has(request.nextUrl.pathname),
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

/**
 * Pages without the signer (legal pages, not found) keep the fixed origins: Google, Homegate and
 * the PKARR relays. No homeserver or relay is reachable from them.
 */
function createContentSecurityPolicy(input: {
  nonce: string;
  development: boolean;
  homegateOrigin: string | null;
  signer: boolean;
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
      ...(input.homegateOrigin ? [input.homegateOrigin] : []),
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      ...(input.signer ? [SIGNER_CONNECT_SOURCE] : []),
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
