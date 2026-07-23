import "server-only";

const defaultHttpRelayOrigin = "https://httprelay.pubky.app";

export function createContentSecurityPolicy(input: {
  nonce: string;
  development: boolean;
  httpRelayUrl?: string;
  browserConnectOrigins?: string;
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
  const httpRelayOrigin = safeOrigin(input.httpRelayUrl) ?? defaultHttpRelayOrigin;
  const browserConnectOrigins = parseBrowserConnectOrigins(input.browserConnectOrigins);

  return [
    "default-src 'self'",
    scriptSource,
    [
      "connect-src 'self'",
      "https://accounts.google.com",
      "https://openidconnect.googleapis.com",
      "https://oauth2.googleapis.com",
      "https://www.googleapis.com",
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      ...browserConnectOrigins,
      httpRelayOrigin,
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

export function parseBrowserConnectOrigins(value: string | undefined): string[] {
  if (!value) return [];

  const origins = [];
  for (const candidate of value.split(",")) {
    const trimmedCandidate = candidate.trim();
    if (!trimmedCandidate) throw invalidBrowserConnectOrigin("empty origin");

    try {
      const url = new URL(trimmedCandidate);
      const isExactOrigin = url.username === ""
        && url.password === ""
        && url.pathname === "/"
        && url.search === ""
        && url.hash === ""
        && !url.hostname.includes("*");
      if (url.protocol !== "https:" || !isExactOrigin) throw new Error("invalid origin");
      origins.push(url.origin);
    } catch {
      throw invalidBrowserConnectOrigin(trimmedCandidate);
    }
  }

  return [...new Set(origins)];
}

function safeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function invalidBrowserConnectOrigin(value: string): Error {
  return new Error(`Invalid PUBKY_BROWSER_CONNECT_ORIGINS entry: ${value}`);
}
