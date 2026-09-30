import { describe, expect, it } from "vitest";

import NEXT_CONFIG from "./next.config";

describe("next config headers", () => {
  it("does not print secret-bearing request URLs through Next logging", () => {
    expect(NEXT_CONFIG.logging).toEqual({ incomingRequests: false });
  });

  it("sets baseline security headers for every response", async () => {
    const headers = await NEXT_CONFIG.headers?.();
    const globalHeaders = headers?.find((entry) => entry.source === "/:path*")?.headers ?? [];
    expect(globalHeaders).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        expect.objectContaining({ key: "Permissions-Policy" }),
      ]),
    );
    expect(globalHeaders.some((header) => header.key === "Content-Security-Policy")).toBe(false);
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("camera=()");
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("microphone=()");
    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("geolocation=()");
  });

  it("sets no-store and no-referrer headers for sensitive callback routes", async () => {
    const headers = await NEXT_CONFIG.headers?.();
    const authorizeHeaders = [
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];

    for (const source of ["/authorize", "/authorize/:path*", "/"]) {
      expect(headers).toContainEqual({
        source,
        headers: expect.arrayContaining(authorizeHeaders),
      });
    }
  });

  it("allows camera access only on the signer routes that offer the QR scanner", async () => {
    const headers = await NEXT_CONFIG.headers?.();
    const globalHeaders = headers?.find((entry) => entry.source === "/:path*")?.headers ?? [];

    expect(headerValue(globalHeaders, "Permissions-Policy")).toContain("camera=()");
    for (const source of ["/authorize", "/authorize/:path*", "/"]) {
      const signerHeaders = headers?.find((entry) => entry.source === source)?.headers ?? [];
      expect(headerValue(signerHeaders, "Permissions-Policy")).toContain("camera=(self)");
      expect(headerValue(signerHeaders, "Permissions-Policy")).toContain("microphone=()");
    }
    expect(headers?.map((entry) => entry.source)).toEqual([
      "/:path*",
      "/authorize",
      "/authorize/:path*",
      "/",
    ]);
  });
});

function headerValue(headers: Array<{ key: string; value: string }>, key: string): string {
  const header = headers.find((entry) => entry.key === key);

  expect(header).toBeDefined();

  return header?.value ?? "";
}
