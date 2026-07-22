// Defense in depth only: callers must still avoid logging sensitive values.

const AUTHORIZATION_URL_REDACTION = "[REDACTED_AUTHORIZATION_URL]";
const URL_PARAMS_REDACTION = "[REDACTED_URL_PARAMS]";
const TOKEN_REDACTION = "[REDACTED_TOKEN]";

const PUBKY_AUTH_URL_PATTERN = /pubkyauth:\/\/[^\s<>'"]+/giu;
const RELATIVE_AUTHORIZE_URL_PATTERN = /(^|[^\w/])\/authorize\?[^\s<>'"]*\bd=[^\s<>'"]*/giu;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>'"]+/giu;
const AUTHORIZATION_HEADER_PATTERN = /\bAuthorization\s*:\s*([^\s,;'\x22]+)\s+([^\s,;'\x22]+)/giu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const SENSITIVE_TOKEN_KEYS = [
  "id_token",
  "access_token",
  "drive_token",
  "refresh_token",
  "token",
  "secret",
  "wrapping_key",
  "credential",
  "idToken",
  "accessToken",
  "driveAccessToken",
  "refreshToken",
  "googleIdToken",
  "wrappingKey",
  "authSecret",
  "clientSecret",
  "serverSecret",
  "serverSecretBase64",
  "PASSPORT_SERVER_SECRET_BASE64",
  "signupCode",
  "secretKey",
  "privateKey",
  "keyMaterial",
].join("|");
const JSON_TOKEN_VALUE_PATTERN = new RegExp(`(["'])\\b(${SENSITIVE_TOKEN_KEYS})\\b\\1\\s*:\\s*(["'])[^"']+\\3`, "giu");
const TOKEN_VALUE_PATTERN = new RegExp(`\\b(${SENSITIVE_TOKEN_KEYS})\\b\\s*[:=]\\s*([^\\s,;&'\"]+)`, "giu");
// A 32-byte secret encoded as base64url is exactly 43 characters. This covers
// the server-derived wrapping key (server/wrapping-key/google/keyDeriver.ts) and the Pubky auth
// client_secret, so bare tokens of 43+ characters must be redacted even when
// they appear without key=value, JSON, or URL context. The threshold stays
// above 40 so full git SHA-1 hashes (40 hex chars) remain visible as useful,
// non-sensitive diagnostics; we err toward redaction for anything longer.
const OPAQUE_TOKEN_PATTERN = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{43,}={0,2}(?![A-Za-z0-9+/_=-])/gu;

export function redactAuthorizationUrls(value: string): string {
  return value
    .replace(PUBKY_AUTH_URL_PATTERN, AUTHORIZATION_URL_REDACTION)
    .replace(RELATIVE_AUTHORIZE_URL_PATTERN, (_match, prefix: string) => `${prefix}${AUTHORIZATION_URL_REDACTION}`)
    .replace(HTTP_URL_PATTERN, (match) =>
      isPassportAuthorizationUrl(match) ? AUTHORIZATION_URL_REDACTION : match,
    );
}

export function redactHttpUrlParams(value: string): string {
  return value.replace(HTTP_URL_PATTERN, (match) => redactUrlQuery(match));
}

export function redactTokenLikeValues(value: string): string {
  return value
    .replace(AUTHORIZATION_HEADER_PATTERN, (_match, scheme: string) => `Authorization: ${scheme} ${TOKEN_REDACTION}`)
    .replace(JWT_PATTERN, TOKEN_REDACTION)
    .replace(JSON_TOKEN_VALUE_PATTERN, (_match, keyQuote: string, key: string, valueQuote: string) => `${keyQuote}${key}${keyQuote}:${valueQuote}${TOKEN_REDACTION}${valueQuote}`)
    .replace(TOKEN_VALUE_PATTERN, (_match, key: string) => `${key}=${TOKEN_REDACTION}`)
    .replace(OPAQUE_TOKEN_PATTERN, TOKEN_REDACTION);
}

export function redactForLog(value: string): string {
  return redactTokenLikeValues(redactHttpUrlParams(redactAuthorizationUrls(value)));
}

function isPassportAuthorizationUrl(value: string): boolean {
  const url = parseUrl(value);

  return url?.pathname === "/authorize" && url.searchParams.has("d");
}

function redactUrlQuery(value: string): string {
  const url = parseUrl(value);

  if (!url || (url.search === "" && url.hash === "")) {
    return value;
  }

  return `${url.origin}${url.pathname}?${URL_PARAMS_REDACTION}`;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
