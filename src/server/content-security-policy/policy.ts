import "server-only";

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
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    ...(input.development ? ["'unsafe-eval'"] : []),
    "https://accounts.google.com",
    "https://apis.google.com",
  ].join(" ");
  return [
    "default-src 'self'",
    scriptSource,
    [
      "connect-src 'self'",
      "https://accounts.google.com",
      "https://openidconnect.googleapis.com",
      "https://oauth2.googleapis.com",
      "https://www.googleapis.com",
      input.homegateOrigin,
      ...input.homeserverConnectOrigins,
      "https://pkarr.pubky.app",
      "https://pkarr.pubky.org",
      ...(input.allowPubkyAuthRelays ? ["https:"] : []),
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
