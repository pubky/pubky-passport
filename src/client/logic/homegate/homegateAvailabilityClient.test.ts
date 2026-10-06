import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGGER } from "@/libs/logger/logger";
import { HomegateAvailabilityClient, type VerificationMethod } from "./HomegateAvailabilityClient";

afterEach(() => vi.restoreAllMocks());

describe("HomegateAvailabilityClient", () => {
  it.each([
    ["sms", "/sms_verification/info", 200, ""],
    ["lightning", "/ln_verification/info", 200, '{"amountSat":10}'],
    ["google", "/google_verification", 405, ""],
  ] as const)(
    "discovers %s using a read-only, credential-free GET",
    async (method, path, status, body) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(body, { status }));
      const result = await new HomegateAvailabilityClient("https://homegate.example/", fetch).check(
        method,
        new AbortController().signal,
      );
      expect(result).toMatchObject({ status: "available", httpStatus: status });
      expect(fetch).toHaveBeenCalledWith(
        new URL(path, "https://homegate.example/"),
        expect.objectContaining({
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
        }),
      );
      expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined();
      expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Content-Type");
    },
  );

  it.each(["sms", "lightning", "google"] as const)(
    "distinguishes disabled, regional, and uncertain %s responses",
    async (method: VerificationMethod) => {
      for (const [httpStatus, status] of [
        [404, "unavailable"],
        [403, "blocked"],
        [429, "unknown"],
        [500, "unknown"],
        [503, "unknown"],
      ] as const) {
        const fetch = vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(new Response(null, { status: httpStatus }));
        expect(
          await new HomegateAvailabilityClient("https://homegate.example/", fetch).check(
            method,
            new AbortController().signal,
          ),
        ).toEqual({ status, httpStatus });
      }
    },
  );

  it.each(["", "not-json", "{}", '{"amountSat":0}', '{"amountSat":"10"}', "x".repeat(1025)])(
    "does not enable Lightning on malformed info %s",
    async (body) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
      expect(
        await new HomegateAvailabilityClient("https://homegate.example/", fetch).check(
          "lightning",
          new AbortController().signal,
        ),
      ).toEqual({ status: "unknown", httpStatus: 200 });
    },
  );

  it("does not mistake a Google fallback page for a mounted verification endpoint", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("Homegate Service"));
    expect(
      await new HomegateAvailabilityClient("https://homegate.example/", fetch).check(
        "google",
        new AbortController().signal,
      ),
    ).toEqual({ status: "unknown", httpStatus: 200 });
  });

  it("treats an unauthorized probe as uncertain rather than blocked or missing", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("", { status: 401 }));
    expect(
      await new HomegateAvailabilityClient("https://homegate.example/", fetch).check(
        "sms",
        new AbortController().signal,
      ),
    ).toEqual({ status: "unknown", httpStatus: 401 });
  });

  it("reports an aborted probe as unknown without logging it as a failure", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_, init) => {
      controller.abort();
      return Promise.reject(init?.signal?.reason ?? new DOMException("aborted", "AbortError"));
    });
    expect(
      await new HomegateAvailabilityClient("https://homegate.example/", fetch).check(
        "lightning",
        controller.signal,
      ),
    ).toEqual({ status: "unknown" });
    expect(warning).not.toHaveBeenCalled();
  });

  it("does not invent an HTTP status or regional block for a network/CORS failure", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    expect(
      await new HomegateAvailabilityClient("https://homegate.example/", fetch).check(
        "sms",
        new AbortController().signal,
      ),
    ).toEqual({ status: "unknown" });
  });
});
