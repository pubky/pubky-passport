import { describe, expect, it } from "vitest";

import { POST, createWrappingKeyPostHandler } from "./route";
import type { RequestWrappingKeyController } from "../../../core/controllers/identity/requestWrappingKeyController";

describe("POST /api/wrapping-key", () => {
  it("maps valid controller results to HTTP success", async () => {
    const post = createWrappingKeyPostHandler(controller({ status: 200, body: { wrappingKey: "opaque-key" } }));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ wrappingKey: "opaque-key" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("rejects malformed JSON with a safe 400", async () => {
    const post = createWrappingKeyPostHandler(controller({ status: 200, body: { wrappingKey: "opaque-key" } }));

    const response = await post(
      new Request("http://localhost/api/wrapping-key", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects missing, non-string, and empty tokens", async () => {
    const post = createWrappingKeyPostHandler(controller({ status: 200, body: { wrappingKey: "opaque-key" } }));

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
    let controllerCalls = 0;
    const post = createWrappingKeyPostHandler(async () => {
      controllerCalls += 1;
      return { status: 200, body: { wrappingKey: "opaque-key" } };
    });

    const response = await post(
      jsonRequest({
        googleIdToken: "id-token",
        driveAccessToken: "drive-token",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(controllerCalls).toBe(0);
  });

  it("maps expected controller failures to fixed HTTP statuses", async () => {
    await expect(
      createWrappingKeyPostHandler(controller({ status: 401, body: { error: { code: "invalid_google_id_token" } } }))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 401, body: { error: { code: "invalid_google_id_token" } } });

    await expect(
      createWrappingKeyPostHandler(controller({ status: 429, body: { error: { code: "rate_limited" } } }))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 429, body: { error: { code: "rate_limited" } } });

    await expect(
      createWrappingKeyPostHandler(controller({ status: 503, body: { error: { code: "dependency_unavailable" } } }))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 503, body: { error: { code: "dependency_unavailable" } } });
  });

  it("maps unexpected controller failures to safe 500 responses", async () => {
    const post = createWrappingKeyPostHandler(async () => {
      throw new Error("token must not leak");
    });

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "internal_error" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails safely with 503 until concrete server adapters are wired", async () => {
    const response = await POST(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "dependency_unavailable" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

function controller(result: Awaited<ReturnType<RequestWrappingKeyController>>): RequestWrappingKeyController {
  return async () => result;
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/wrapping-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseSummary(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}
