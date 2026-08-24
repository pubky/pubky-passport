import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { createGoogleWrappingKeyPostHandler } from "./handler";
import { GoogleWrappingKeyIssuer } from "../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer";

describe("POST /api/wrapping-key/google", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps valid wrapping-key results to HTTP success", async () => {
    const post = postHandler(async () => Result.ok("opaque-key"));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ wrappingKey: "opaque-key" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("does not construct configured dependencies for invalid requests", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const fromEnvironment = vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment");
    const post = createGoogleWrappingKeyPostHandler();

    const response = await post(jsonRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(fromEnvironment).not.toHaveBeenCalled();
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
    const post = postHandler(async () => Result.err({ code }));

    await expect(post(jsonRequest({ googleIdToken: "id-token" })).then(responseSummary)).resolves.toEqual({
      status,
      body: { error: { code } },
    });
  });

  it("reuses the configured wrapping-key request flow", async () => {
    const issuer = wrappingKeyIssuer(async () => Result.ok("opaque-key"));
    const fromEnvironment = vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment").mockReturnValue(issuer);
    const post = createGoogleWrappingKeyPostHandler();

    await Promise.all([
      post(jsonRequest({ googleIdToken: "first-id-token" })),
      post(jsonRequest({ googleIdToken: "second-id-token" })),
    ]);

    expect(fromEnvironment).toHaveBeenCalledOnce();
  });

  it("retries composition after a factory failure", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const issuer = wrappingKeyIssuer(async () => Result.ok("opaque-key"));
    const fromEnvironment = vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment")
      .mockImplementationOnce(() => {
        throw new Error("configuration temporarily unavailable");
      })
      .mockReturnValue(issuer);
    const post = createGoogleWrappingKeyPostHandler();

    expect((await post(jsonRequest({ googleIdToken: "first-id-token" }))).status).toBe(500);
    expect((await post(jsonRequest({ googleIdToken: "second-id-token" }))).status).toBe(200);
    expect(fromEnvironment).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith("identity.google.wrapping_key.failed", {
      route: "api.wrapping_key.google",
      layer: "route",
      operation: "compose",
      code: "internal_error",
    });
  });

  it("maps unexpected wrapping-key failures to safe 500 responses", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const post = postHandler(async () => {
      throw new Error("SECRET-GOOGLE-ID-TOKEN");
    });

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

function postHandler(issueGoogleWrappingKey: GoogleWrappingKeyIssuer["issueGoogleWrappingKey"]) {
  const issuer = wrappingKeyIssuer(issueGoogleWrappingKey);
  vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment").mockReturnValue(issuer);
  return createGoogleWrappingKeyPostHandler();
}

function wrappingKeyIssuer(
  issueGoogleWrappingKey: GoogleWrappingKeyIssuer["issueGoogleWrappingKey"],
): GoogleWrappingKeyIssuer {
  const issuer = new GoogleWrappingKeyIssuer("test-client", new Uint8Array(32));
  vi.spyOn(issuer, "issueGoogleWrappingKey").mockImplementation(issueGoogleWrappingKey);
  return issuer;
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
