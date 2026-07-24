import "server-only";

import { Result } from "better-result";

import {
  extractRawPubkyAuthRequestQueryValue,
  parsePubkyAuthRequest,
} from "../../core/auth/parsePubkyAuthRequest";
import { parseHomegateBaseUrl } from "../../core/homegate/parseHomegateBaseUrl";

export function createContentSecurityPolicy(input: {
  nonce: string;
  development: boolean;
  homegateBaseUrl: string;
  authorizationRequestSearch?: string;
}): string {
  const scriptSource = [
    "script-src 'self'",
    `'nonce-${input.nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    ...(input.development ? ["'unsafe-eval'"] : []),
    "https://accounts.google.com",
    "https://apis.google.com",
  ].join(" ");
  const authorizationRelayOrigin = input.authorizationRequestSearch
    ? parseAuthorizationRelayOrigin(input.authorizationRequestSearch)
    : undefined;
  const homegateBaseUrl = parseHomegateBaseUrl(input.homegateBaseUrl);
  if (!homegateBaseUrl) throw new Error("Invalid Homegate URL configuration.");

  return [
    "default-src 'self'",
    scriptSource,
    [
      "connect-src 'self'",
      "https://accounts.google.com",
      "https://openidconnect.googleapis.com",
      "https://oauth2.googleapis.com",
      "https://www.googleapis.com",
      homegateBaseUrl.origin,
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      ...(authorizationRelayOrigin ? [authorizationRelayOrigin] : []),
    ].join(" "),
    "img-src 'self' data: https://*.googleusercontent.com",
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

function parseAuthorizationRelayOrigin(search: string): string | undefined {
  const rawD = extractRawPubkyAuthRequestQueryValue(search);
  if (!rawD.valid) return undefined;

  const parsed = parsePubkyAuthRequest(rawD.value);
  if (Result.isError(parsed)) return undefined;

  return parsed.value.relayOrigin;
}
