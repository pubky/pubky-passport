import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { createGoogleWrappingKeyPostHandler } from "./handler";
import type {
  GoogleWrappingKeyRequest,
  GoogleWrappingKeyRequestResult,
} from "../../../../server/wrapping-key/google/request";

describe("POST /api/wrapping-key/google", () => {
  it("maps valid wrapping-key results to HTTP success", async () => {
    const post = createGoogleWrappingKeyPostHandler(wrappingKeyRequest(Result.ok("opaque-key")));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ wrappingKey: "opaque-key" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("rejects malformed JSON with a safe 400", async () => {
    const post = createGoogleWrappingKeyPostHandler(wrappingKeyRequest(Result.ok("opaque-key")));

    const response = await post(
        new Request("http://localhost/api/wrapping-key/google", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("requires an application/json content type", async () => {
    const post = createGoogleWrappingKeyPostHandler(wrappingKeyRequest(Result.ok("opaque-key")));

    const response = await post(new Request("http://localhost/api/wrapping-key/google", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ googleIdToken: "id-token" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
  });

  it("rejects oversized request bodies before deriving a wrapping key", async () => {
    let requestCalls = 0;
    const post = createGoogleWrappingKeyPostHandler({
      async requestWrappingKey() {
        requestCalls += 1;
        return Result.ok("opaque-key");
      },
    });

    const response = await post(oversizedRequest("http://localhost/api/wrapping-key/google"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(requestCalls).toBe(0);
  });

  it("rejects missing, non-string, and empty tokens", async () => {
    const post = createGoogleWrappingKeyPostHandler(wrappingKeyRequest(Result.ok("opaque-key")));

    await expect(post(jsonRequest({})).then(responseSummary)).resolves.toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    await expect(post(jsonRequest({ googleIdToken: 123 })).then(responseSummary)).resolves.toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    await expect(post(jsonRequest({ googleIdToken: "   " })).then(responseSummary)).resolves.toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("rejects unknown fields so Drive and key material cannot be sent", async () => {
    let requestCalls = 0;
    const post = createGoogleWrappingKeyPostHandler({
      async requestWrappingKey() {
        requestCalls += 1;
        return Result.ok("opaque-key");
      },
    });

    const response = await post(
      jsonRequest({
        googleIdToken: "id-token",
        driveAccessToken: "drive-token",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(requestCalls).toBe(0);
  });

  it("maps expected wrapping-key failures to fixed HTTP statuses", async () => {
    await expect(
      createGoogleWrappingKeyPostHandler(wrappingKeyRequest(Result.err({ code: "invalid_google_id_token" })))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 401, body: { error: { code: "invalid_google_id_token" } } });

    await expect(
      createGoogleWrappingKeyPostHandler(wrappingKeyRequest(Result.err({ code: "rate_limited" })))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 429, body: { error: { code: "rate_limited" } } });

    await expect(
      createGoogleWrappingKeyPostHandler(wrappingKeyRequest(Result.err({ code: "dependency_unavailable" })))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 503, body: { error: { code: "dependency_unavailable" } } });
  });

  it("reuses the default wrapping-key request flow", async () => {
    let factoryCalls = 0;
    const post = createGoogleWrappingKeyPostHandler(undefined, async () => {
      factoryCalls += 1;
      return wrappingKeyRequest(Result.ok("opaque-key"));
    });

    await Promise.all([
      post(jsonRequest({ googleIdToken: "first-id-token" })),
      post(jsonRequest({ googleIdToken: "second-id-token" })),
    ]);

    expect(factoryCalls).toBe(1);
  });

  it("maps unexpected wrapping-key failures to safe 500 responses", async () => {
    const post = createGoogleWrappingKeyPostHandler({
      async requestWrappingKey() {
        throw new Error("token must not leak");
      },
    });

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "internal_error" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

});

function wrappingKeyRequest(result: GoogleWrappingKeyRequestResult): GoogleWrappingKeyRequest {
  return {
    async requestWrappingKey() {
      return result;
    },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/wrapping-key/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function oversizedRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Length": String(16 * 1024 + 1) },
    body: "{}",
  });
}

async function responseSummary(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}
