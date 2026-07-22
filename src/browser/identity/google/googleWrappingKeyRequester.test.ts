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

  it("returns a safe HTTP status when the route has no JSON error body", async () => {
    const requester = new BrowserGoogleWrappingKeyRequester({ async fetch() { return new Response("unavailable", { status: 503 }); } });
    const result = await requester.requestWrappingKey({ googleIdToken: "id-token" });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "http_503" });
  });
});
