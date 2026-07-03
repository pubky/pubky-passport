import { describe, expect, it } from "vitest";

import nextConfig from "../next.config.mjs";

describe("next config headers", () => {
  it("sets global baseline security headers", async () => {
    const headers = await nextConfig.headers?.();
    const globalHeaders = headers?.find((entry) => entry.source === "/:path*");

    expect(globalHeaders).toBeDefined();
    expect(globalHeaders?.headers).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
    expect(globalHeaders?.headers).toContainEqual({
      key: "Permissions-Policy",
      value:
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    });

    const csp = globalHeaders?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("sets no-store and no-referrer headers for /authorize and subpaths", async () => {
    const headers = await nextConfig.headers?.();

    expect(headers).toContainEqual({
      source: "/authorize/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    });
  });
});
