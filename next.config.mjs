import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://apis.google.com",
  "style-src 'self'",
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://drive.googleapis.com https://content.googleapis.com https://httprelay.pubky.app",
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const BASELINE_SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: CONTENT_SECURITY_POLICY,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  },
];

const AUTHORIZE_HEADERS = [
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
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["@synonymdev/pubky"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: BASELINE_SECURITY_HEADERS,
      },
      {
        source: "/authorize/:path*",
        headers: AUTHORIZE_HEADERS,
      },
    ];
  },
};

export default nextConfig;
