import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "./libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "./libs/authorization/earlyGoogleImplicitResponse";
import { isCspSafeHostname } from "./libs/http/cspSafeHostname";
import { LOGGER } from "./libs/logger/logger";
import { getBrowserBootstrapConfig } from "./server/config/browserBootstrapConfig";

const MAXIMUM_HOMESERVER_ORIGINS_CHARACTERS = 8_192;
const MAXIMUM_URL_CHARACTERS = 2_048;
const MAXIMUM_HOMESERVER_ORIGINS = 16;
const EARLY_AUTHORIZATION_LOCATION_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_AUTHORIZATION_LOCATION_SCRIPT)
  .digest("base64")}'`;
const EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT)
  .digest("base64")}'`;

export function proxy(request: NextRequest) {
  try {
    const config = getBrowserBootstrapConfig();
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const contentSecurityPolicy = createContentSecurityPolicy({
      nonce,
      development: process.env.NODE_ENV === "development",
      homegateOrigin: config.homegateOrigin,
      homeserverConnectOrigins: getHomeserverConnectOrigins(),
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
  } catch (error) {
    LOGGER.error("proxy.bootstrap.failed", {
      layer: "proxy",
      operation: "build_response_policy",
      code: "runtime_exception",
    });
    throw error;
  }
}

function getHomeserverConnectOrigins(): string[] {
  return z.string().trim().min(1, "PUBKY_HOMESERVER_CONNECT_ORIGINS is required")
    .transform((value, context) => {
      const origins = parseHomeserverConnectOrigins(value);
      if (origins) return origins;
      context.addIssue({
        code: "custom",
        message: "PUBKY_HOMESERVER_CONNECT_ORIGINS must contain CSP-safe HTTPS origins",
      });
      return z.NEVER;
    })
    .parse(process.env.PUBKY_HOMESERVER_CONNECT_ORIGINS);
}

function parseHomeserverConnectOrigins(value: string): string[] | null {
  if (value.length > MAXIMUM_HOMESERVER_ORIGINS_CHARACTERS) return null;
  const values = value.split(",").map((entry) => entry.trim());
  if (
    values.length > MAXIMUM_HOMESERVER_ORIGINS
    || values.some((entry) => entry.length === 0)
  ) {
    return null;
  }

  const origins: string[] = [];
  for (const value of values) {
    const origin = parseCspSafeHttpsOrigin(value);
    if (!origin) return null;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

function parseCspSafeHttpsOrigin(value: string): string | null {
  if (value.length > MAXIMUM_URL_CHARACTERS) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || !isCspSafeHostname(url.hostname)
  ) {
    return null;
  }
  return url.origin;
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
