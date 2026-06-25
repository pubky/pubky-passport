import { describe, expect, it } from "vitest";

import nextConfig from "../next.config.mjs";

describe("next config headers", () => {
  it("sets no-store and no-referrer headers for /authorize", async () => {
    const headers = await nextConfig.headers?.();

    expect(headers).toContainEqual({
      source: "/authorize",
      headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    });
  });
});
