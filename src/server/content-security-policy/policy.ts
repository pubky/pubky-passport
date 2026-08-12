import "server-only";

import { createHash } from "node:crypto";

import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "../../libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT } from "../../libs/authorization/earlyGoogleOAuthResponse";

const EARLY_AUTHORIZATION_LOCATION_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_AUTHORIZATION_LOCATION_SCRIPT)
  .digest("base64")}'`;
const EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT)
  .digest("base64")}'`;

export function createContentSecurityPolicy(input: {
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
    EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT_SOURCE,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    ...(input.development ? ["'unsafe-eval'"] : []),
    "https://accounts.google.com",
  ].join(" ");
  return [
    "default-src 'self'",
    scriptSource,
    [
      "connect-src 'self'",
      "https://accounts.google.com",
      "https://openidconnect.googleapis.com",
      "https://www.googleapis.com",
      input.homegateOrigin,
      ...input.homeserverConnectOrigins,
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      ...(input.allowPubkyAuthRelays ? ["https:"] : []),
    ].join(" "),
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com",
    "font-src 'self'",
    "frame-src https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ].join("; ");
}
