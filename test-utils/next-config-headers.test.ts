import { describe, expect, it } from "vitest";

import NEXT_CONFIG from "../next.config.mjs";

describe("next config headers", () => {
  it("hides the Next.js development indicator", () => {
    expect(NEXT_CONFIG.devIndicators).toBe(false);
  });

  it("does not print secret-bearing request URLs through Next logging", () => {
    expect(NEXT_CONFIG.logging).toEqual({ incomingRequests: false });
  });

  it("sets baseline security headers for every response", async () => {
    const headers = await NEXT_CONFIG.headers?.();
    const globalHeaders = headers?.find((entry) => entry.source === "/:path*")?.headers ?? [];
    expect(globalHeaders).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        expect.objectContaining({ key: "Permissions-Policy" }),
      ]),
    );
    expect(globalHeaders.some((header) => header.key === "Content-Security-Policy")).toBe(false);
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("camera=()");
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("microphone=()");
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("geolocation=()");
  });

  it("sets no-store and no-referrer headers for /authorize and subpaths", async () => {
    const headers = await NEXT_CONFIG.headers?.();
    const authorizeHeaders = [
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];

    expect(headers).toContainEqual({
      source: "/authorize",
      headers: authorizeHeaders,
    });
    expect(headers).toContainEqual({
      source: "/authorize/:path*",
      headers: authorizeHeaders,
    });
  });

});

function headerValue(headers: Array<{ key: string; value: string }>, key: string): string {
  const header = headers.find((entry) => entry.key === key);

  expect(header).toBeDefined();

  return header?.value ?? "";
}
