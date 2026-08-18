import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { createGoogleWrappingKeyPostHandler } from "./handler";
import { GoogleIdTokenVerifier } from "../../../../server/wrapping-key/google/GoogleIdTokenVerifier";
import { GoogleWrappingKeyDeriver } from "../../../../server/wrapping-key/google/GoogleWrappingKeyDeriver";
import { InMemoryGoogleWrappingKeyRateLimiter } from "../../../../server/wrapping-key/google/InMemoryGoogleWrappingKeyRateLimiter";
import {
  GoogleWrappingKeyRequest,
  type GoogleWrappingKeyRequestResult,
} from "../../../../server/wrapping-key/google/GoogleWrappingKeyRequest";

describe("POST /api/wrapping-key/google", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps valid wrapping-key results to HTTP success", async () => {
    const post = createGoogleWrappingKeyPostHandler(wrappingKeyRequestFactory(Result.ok("opaque-key")));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ wrappingKey: "opaque-key" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("does not construct configured dependencies for invalid requests", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    let factoryCalls = 0;
    const post = createGoogleWrappingKeyPostHandler(() => {
      factoryCalls += 1;
      return concreteWrappingKeyRequest(async () => {
          return Result.ok("opaque-key");
      });
    });

    const response = await post(jsonRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(factoryCalls).toBe(0);
    expect(info).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      route: "api.wrapping_key.google",
      layer: "route",
      operation: "parse",
      code: "invalid_request",
    });
  });

  it.each([
    ["invalid_google_id_token", 401],
    ["rate_limited", 429],
    ["dependency_unavailable", 503],
  ] as const)("maps %s failures to HTTP %i", async (code, status) => {
    const post = createGoogleWrappingKeyPostHandler(wrappingKeyRequestFactory(Result.err({ code })));

    await expect(post(jsonRequest({ googleIdToken: "id-token" })).then(responseSummary)).resolves.toEqual({
      status,
      body: { error: { code } },
    });
  });

  it("reuses the configured wrapping-key request flow", async () => {
    let factoryCalls = 0;
    const post = createGoogleWrappingKeyPostHandler(() => {
      factoryCalls += 1;
      return concreteWrappingKeyRequest(async () => {
          return Result.ok("opaque-key");
      });
    });

    await Promise.all([
      post(jsonRequest({ googleIdToken: "first-id-token" })),
      post(jsonRequest({ googleIdToken: "second-id-token" })),
    ]);

    expect(factoryCalls).toBe(1);
  });

  it("retries composition after a factory failure", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    let factoryCalls = 0;
    const post = createGoogleWrappingKeyPostHandler(() => {
      factoryCalls += 1;
      if (factoryCalls === 1) throw new Error("configuration temporarily unavailable");
      return concreteWrappingKeyRequest(async () => {
          return Result.ok("opaque-key");
      });
    });

    expect((await post(jsonRequest({ googleIdToken: "first-id-token" }))).status).toBe(500);
    expect((await post(jsonRequest({ googleIdToken: "second-id-token" }))).status).toBe(200);
    expect(factoryCalls).toBe(2);
    expect(error).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      route: "api.wrapping_key.google",
      layer: "route",
      operation: "compose",
      code: "internal_error",
    });
  });

  it("maps unexpected wrapping-key failures to safe 500 responses", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const post = createGoogleWrappingKeyPostHandler(() => concreteWrappingKeyRequest(async () => {
        throw new Error("SECRET-GOOGLE-ID-TOKEN");
    }));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "internal_error" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(error).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      route: "api.wrapping_key.google",
      layer: "route",
      operation: "execute",
      code: "internal_error",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

});

function wrappingKeyRequestFactory(result: GoogleWrappingKeyRequestResult) {
  return () => concreteWrappingKeyRequest(async () => result);
}

function concreteWrappingKeyRequest(
  requestGoogleWrappingKey: GoogleWrappingKeyRequest["requestGoogleWrappingKey"],
): GoogleWrappingKeyRequest {
  return new TestGoogleWrappingKeyRequest(requestGoogleWrappingKey);
}

class TestGoogleWrappingKeyRequest extends GoogleWrappingKeyRequest {
  constructor(private request: GoogleWrappingKeyRequest["requestGoogleWrappingKey"]) {
    super(
      new GoogleIdTokenVerifier("test-client"),
      new InMemoryGoogleWrappingKeyRateLimiter(new Uint8Array(32)),
      new GoogleWrappingKeyDeriver(new Uint8Array(32)),
    );
  }

  override requestGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyRequestResult> {
    return this.request(googleIdToken);
  }
}

function jsonRequest(body: unknown): Request {
  return new Request("https://passport.pubky.app/api/wrapping-key/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseSummary(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}
