import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { LOGGER } from "@/libs/logger/logger";
import { HomegateTransport } from "./HomegateTransport";

const PROXY_PAGE = `<html><body>${"Access denied by the regional proxy. ".repeat(20)}</body></html>`;

function transport(response: Response | (() => Response)) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => (typeof response === "function" ? response() : response));
  const mapError = vi.fn((_body: string | null, status: number) =>
    status === 403 ? ("blocked" as const) : status === 429 ? ("rate_limited" as const) : "other",
  );
  return {
    fetch,
    mapError,
    client: new HomegateTransport("https://homegate.example", fetch, "test.failed", mapError),
  };
}

describe("HomegateTransport", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [403, "blocked"],
    [429, "rate_limited"],
  ] as const)(
    "keeps the HTTP %s meaning when a proxy error page exceeds the error body limit",
    async (status, code) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      expect(PROXY_PAGE.length).toBeGreaterThan(256);
      const { client, mapError } = transport(new Response(PROXY_PAGE, { status }));

      const result = await client.request("/ln_verification/id", "poll", z.unknown(), {
        method: "GET",
      });

      expect(result).toMatchObject({ error: { code, httpStatus: status } });
      expect(mapError).toHaveBeenCalledWith(null, status);
      expect(JSON.stringify(result)).not.toContain("regional proxy");
    },
  );

  it("sends Content-Type only with a JSON body", async () => {
    const { client, fetch } = transport(() => Response.json({ ok: true }));

    await client.request("/ln_verification/id", "poll", z.unknown(), { method: "GET" });
    await client.request("/ln_verification", "create", z.unknown(), { body: { value: 1 } });

    const [getInit, postInit] = fetch.mock.calls.map(([, init]) => init);
    expect(getInit).toMatchObject({ method: "GET", headers: { Accept: expect.any(String) } });
    expect(getInit?.headers).not.toHaveProperty("Content-Type");
    expect(getInit?.body).toBeUndefined();
    expect(postInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
  });

  it("reports an aborted error-body read as a network failure", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const screen = new AbortController();
    const { client, mapError } = transport(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              screen.signal.addEventListener("abort", () => controller.error(new Error("left")));
            },
          }),
          { status: 429 },
        ),
    );

    const pending = client.request("/ln_verification/id", "poll", z.unknown(), {
      method: "GET",
      signal: screen.signal,
    });
    await Promise.resolve();
    screen.abort();

    const result = await pending;
    expect(Result.isError(result) && result.error.code).toBe("network_failed");
    expect(mapError).not.toHaveBeenCalled();
  });
});
