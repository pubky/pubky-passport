import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
