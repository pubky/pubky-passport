import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { BrowserGoogleWrappingKeyRequester } from "./googleWrappingKeyRequester";

describe("BrowserGoogleWrappingKeyRequester", () => {
  it("sends only the ID token to the wrapping-key endpoint", async () => {
    let request: Request | undefined;
    let endpoint: RequestInfo | URL | undefined;
    const requester = new BrowserGoogleWrappingKeyRequester({
      async fetch(input, init) {
        endpoint = input;
        request = new Request("http://localhost/api/wrapping-key/google", init);
        return Response.json({ wrappingKey: "w".repeat(43) });
      },
    });

    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });

    expect(Result.isError(result)).toBe(false);
    expect(endpoint).toBe("/api/wrapping-key/google");
    await expect(request?.json()).resolves.toEqual({ googleIdToken: "id-token" });
  });

  it("returns the route's safe typed error code", async () => {
    const requester = new BrowserGoogleWrappingKeyRequester({
      async fetch() {
        return Response.json({ error: { code: "unsupported_google_audience" } }, { status: 401 });
      },
    });

    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "unsupported_google_audience" });
  });

  it("rejects unknown route errors instead of creating dynamic codes", async () => {
    const requester = new BrowserGoogleWrappingKeyRequester({
      async fetch() {
        return Response.json({ error: { code: "future_error" } }, { status: 401 });
      },
    });
    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it("returns invalid_response when the route has no valid error body", async () => {
    const requester = new BrowserGoogleWrappingKeyRequester({ async fetch() { return new Response("unavailable", { status: 503 }); } });
    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it.each([
    { wrappingKey: "w".repeat(42) },
    { wrappingKey: "w".repeat(43), extra: true },
    { wrappingKey: `${"w".repeat(42)}x` },
    { wrappingKey: `${"w".repeat(42)}=` },
  ])("rejects invalid or non-canonical wrapping-key responses", async (body) => {
    const requester = new BrowserGoogleWrappingKeyRequester({ async fetch() { return Response.json(body); } });
    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it("bounds response bodies before parsing", async () => {
    const requester = new BrowserGoogleWrappingKeyRequester({
      async fetch() {
        return Response.json({ padding: "x".repeat(16 * 1024) });
      },
    });
    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
  });

  it("maps fetch failures to network_failed", async () => {
    const requester = new BrowserGoogleWrappingKeyRequester({ async fetch() { throw new TypeError("offline"); } });
    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "network_failed" });
  });
});
