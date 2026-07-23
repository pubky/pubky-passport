import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

parseBrowserConnectOrigins(process.env.PUBKY_BROWSER_CONNECT_ORIGINS);

const baselineSecurityHeaders = [
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
