import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const httpRelayOrigin = safeOrigin(process.env.NEXT_PUBLIC_HTTP_RELAY_URL) ?? "https://httprelay.pubky.app";
const pubkyBrowserConnectOrigins = parseBrowserConnectOrigins(process.env.PUBKY_BROWSER_CONNECT_ORIGINS);
const scriptSource = process.env.NODE_ENV === "development"
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com"
  : "script-src 'self' https://accounts.google.com https://apis.google.com";

const contentSecurityPolicy = [
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
    ...pubkyBrowserConnectOrigins,
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

const baselineSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "encrypted-media=()",
      "fullscreen=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=()",
      "serial=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", "),
  },
];

const authorizeTransportHeaders = [
  {
    key: "Cache-Control",
    value: "no-store",
  },
  {
    key: "Referrer-Policy",
    value: "no-referrer",
  },
];

function safeOrigin(value) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function parseBrowserConnectOrigins(value) {
  if (!value) {
    return [];
  }

  const origins = [];
  for (const candidate of value.split(",")) {
    const trimmedCandidate = candidate.trim();
    if (!trimmedCandidate) {
      throw new Error("Invalid PUBKY_BROWSER_CONNECT_ORIGINS entry: empty origin");
    }

    try {
      const url = new URL(trimmedCandidate);
      const isExactOrigin = url.username === ""
        && url.password === ""
        && url.pathname === "/"
        && url.search === ""
        && url.hash === ""
        && !url.hostname.includes("*");
      if (url.protocol !== "https:" || !isExactOrigin) {
        throw new Error("invalid browser connection origin");
      }

      origins.push(url.origin);
    } catch {
      throw new Error(`Invalid PUBKY_BROWSER_CONNECT_ORIGINS entry: ${trimmedCandidate}`);
    }
  }

  return [...new Set(origins)];
}

export { parseBrowserConnectOrigins };

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["@synonymdev/pubky"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: baselineSecurityHeaders,
      },
      {
        source: "/authorize",
        headers: authorizeTransportHeaders,
      },
      {
        source: "/authorize/:path*",
        headers: authorizeTransportHeaders,
      },
    ];
  },
};

export default nextConfig;
