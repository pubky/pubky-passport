import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const projectRoot = dirname(fileURLToPath(import.meta.url));

function permissionsPolicy(cameraAllowlist: string): string {
  return [
    "accelerometer=()",
    "ambient-light-sensor=()",
    "autoplay=()",
    `camera=${cameraAllowlist}`,
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
  ].join(", ");
}

const BASELINE_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: permissionsPolicy("()") },
];
const AUTHORIZE_TRANSPORT_HEADERS = [
  { key: "Cache-Control", value: "no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
];
const AUTHORIZE_HEADERS = [
  ...AUTHORIZE_TRANSPORT_HEADERS,
  { key: "Permissions-Policy", value: permissionsPolicy("(self)") },
];

const NEXT_CONFIG: NextConfig = {
  devIndicators: false,
  logging: { incomingRequests: false },
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["@synonymdev/pubky"],
  async headers() {
    return [
      { source: "/:path*", headers: BASELINE_SECURITY_HEADERS },
      { source: "/authorize", headers: AUTHORIZE_HEADERS },
      { source: "/authorize/:path*", headers: AUTHORIZE_HEADERS },
      { source: "/", headers: AUTHORIZE_TRANSPORT_HEADERS },
    ];
  },
};

export default NEXT_CONFIG;
