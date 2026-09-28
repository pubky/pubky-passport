import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { AUTHORIZATION_ENTRY_PATH } from "./src/libs/authorization/authorizationLocationRules";

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
/**
 * Both signer routes may request the camera. `/authorize` keeps v1's allowance; `/` needs it because
 * manual entry, with its QR scanner, now runs there before it reloads into `/authorize`.
 */
const SIGNER_HEADERS = [
  ...AUTHORIZE_TRANSPORT_HEADERS,
  { key: "Permissions-Policy", value: permissionsPolicy("(self)") },
];

// Comma-separated hosts (e.g. a remote dev proxy) allowed to reach dev-only resources like HMR.
const ALLOWED_DEV_ORIGINS = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const NEXT_CONFIG: NextConfig = {
  allowedDevOrigins: ALLOWED_DEV_ORIGINS,
  devIndicators: false,
  logging: { incomingRequests: false },
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["@synonymdev/pubky"],
  async headers() {
    return [
      { source: "/:path*", headers: BASELINE_SECURITY_HEADERS },
      { source: AUTHORIZATION_ENTRY_PATH, headers: SIGNER_HEADERS },
      { source: `${AUTHORIZATION_ENTRY_PATH}/:path*`, headers: SIGNER_HEADERS },
      { source: "/", headers: SIGNER_HEADERS },
    ];
  },
};

export default NEXT_CONFIG;
