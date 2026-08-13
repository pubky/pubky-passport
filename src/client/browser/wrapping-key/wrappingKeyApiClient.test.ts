import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { encodeBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import { WrappingKeyApiClient } from "./wrappingKeyApiClient";

describe("WrappingKeyApiClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends only the ID token to the wrapping-key endpoint", async () => {
    let endpoint: RequestInfo | URL | undefined;
    let bodyHasOnlyExpectedIdToken = false;
    let safeRequestOptions: Pick<Request, "cache" | "redirect" | "referrerPolicy"> | undefined;
    const requester = new WrappingKeyApiClient(async (input, init) => {
      endpoint = input;
      const request = new Request("https://passport.pubky.app/api/wrapping-key/google", init);
      const body: unknown = await request.json();
      bodyHasOnlyExpectedIdToken = JSON.stringify(body) === JSON.stringify({ googleIdToken: "id-token" });
      safeRequestOptions = {
        cache: request.cache,
        redirect: request.redirect,
        referrerPolicy: request.referrerPolicy,
      };
      return Response.json({ wrappingKey: encodeBase64Url(new Uint8Array(32).fill(7)) });
    });

    const result = await requester.requestGoogleWrappingKey("id-token");

    expect(Result.isError(result)).toBe(false);
    expect(endpoint).toBe("/api/wrapping-key/google");
    expect(bodyHasOnlyExpectedIdToken).toBe(true);
    expect(safeRequestOptions?.cache).toBe("no-store");
    expect(safeRequestOptions?.redirect).toBe("error");
    expect(safeRequestOptions?.referrerPolicy).toBe("no-referrer");
  });

  it("returns the route's safe typed error code", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const requester = new WrappingKeyApiClient(async () => (
      Response.json({ error: { code: "invalid_google_id_token" } }, { status: 401 })
    ));

    const result = await requester.requestGoogleWrappingKey("id-token");

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_google_id_token" });
    expect(warn).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      operation: "request_google_wrapping_key",
      stage: "error_response",
      code: "invalid_google_id_token",
    });
  });

  it("rejects unknown route errors instead of creating dynamic codes", async () => {
    const requester = new WrappingKeyApiClient(async () => (
      Response.json({ error: { code: "future_error" } }, { status: 401 })
    ));
    const result = await requester.requestGoogleWrappingKey("id-token");
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it("returns invalid_response when the route has no valid error body", async () => {
    const requester = new WrappingKeyApiClient(async () => new Response("unavailable", { status: 503 }));
    const result = await requester.requestGoogleWrappingKey("id-token");
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it.each([
    { wrappingKey: "w".repeat(42) },
    { wrappingKey: "w".repeat(43), extra: true },
    { wrappingKey: `${"w".repeat(42)}x` },
    { wrappingKey: `${"w".repeat(42)}=` },
    { wrappingKey: "A".repeat(44) },
    { wrappingKey: `${"A".repeat(42)}*` },
  ])("rejects invalid or non-canonical wrapping-key responses", async (body) => {
    const requester = new WrappingKeyApiClient(async () => Response.json(body));
    const result = await requester.requestGoogleWrappingKey("id-token");
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it("accepts every canonical terminal character for a 32-byte value", async () => {
    const terminalCharacters: string[] = [];
    for (let value = 0; value < 16; value += 1) {
      const bytes = new Uint8Array(32);
      bytes[31] = value;
      const wrappingKey = encodeBase64Url(bytes);
      terminalCharacters.push(wrappingKey.at(-1) ?? "");
      const requester = new WrappingKeyApiClient(async () => Response.json({ wrappingKey }));

      expect(Result.isOk(await requester.requestGoogleWrappingKey("id-token"))).toBe(true);
    }

    expect(terminalCharacters).toEqual(["A", "E", "I", "M", "Q", "U", "Y", "c", "g", "k", "o", "s", "w", "0", "4", "8"]);
  });

  it("accepts representative 32-byte base64url round trips", async () => {
    for (const bytes of [
      new Uint8Array(32),
      new Uint8Array(32).fill(255),
      crypto.getRandomValues(new Uint8Array(32)),
      Uint8Array.from({ length: 32 }, (_, index) => index),
    ]) {
      const wrappingKey = encodeBase64Url(bytes);
      const requester = new WrappingKeyApiClient(async () => Response.json({ wrappingKey }));
      const result = await requester.requestGoogleWrappingKey("id-token");
      expect(Result.isError(result)).toBe(false);
      if (!Result.isError(result)) expect(result.value).toBe(wrappingKey);
    }
  });

  it("bounds response bodies before parsing", async () => {
    const requester = new WrappingKeyApiClient(async () => (
      Response.json({ padding: "x".repeat(16 * 1024) })
    ));
    const result = await requester.requestGoogleWrappingKey("id-token");
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it("maps fetch failures to network_failed", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const requester = new WrappingKeyApiClient(async () => {
      throw new TypeError("SECRET-GOOGLE-ID-TOKEN");
    });
    const result = await requester.requestGoogleWrappingKey("SECRET-GOOGLE-ID-TOKEN");
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "network_failed" });
    expect(warn).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      operation: "request_google_wrapping_key",
      stage: "request",
      code: "network_failed",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });
});
