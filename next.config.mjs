import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASELINE_SECURITY_HEADERS = [
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

const AUTHORIZE_TRANSPORT_HEADERS = [
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
const NEXT_CONFIG = {
  devIndicators: false,
  logging: {
    incomingRequests: false,
  },
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["@synonymdev/pubky"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: BASELINE_SECURITY_HEADERS,
      },
      {
        source: "/authorize",
        headers: AUTHORIZE_TRANSPORT_HEADERS,
      },
      {
        source: "/authorize/:path*",
        headers: AUTHORIZE_TRANSPORT_HEADERS,
      },
    ];
  },
};

export default NEXT_CONFIG;
