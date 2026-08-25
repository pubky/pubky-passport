import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type { GoogleWrappingKeyIssuer } from "../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer";

describe("POST /api/wrapping-key/google", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("maps valid wrapping-key results to HTTP success", async () => {
    const post = await postHandler(async () => Result.ok("opaque-key"));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ wrappingKey: "opaque-key" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("does not construct configured dependencies for invalid requests", async () => {
    const { GoogleWrappingKeyIssuer, LOGGER, post } = await handlerContext();
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const fromEnvironment = vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment");

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
    const post = await postHandler(async () => Result.err({ code }));

    await expect(post(jsonRequest({ googleIdToken: "id-token" })).then(responseSummary)).resolves.toEqual({
      status,
      body: { error: { code } },
    });
  });

  it("never serializes an internal failure cause", async () => {
    const cause = new Error("SECRET-GOOGLE-ID-TOKEN");
    const post = await postHandler(async () => Result.err({
      code: "dependency_unavailable" as const,
      cause,
    }));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toEqual({ error: { code: "dependency_unavailable" } });
    expect(responseText).not.toContain("cause");
    expect(responseText).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("reuses the configured wrapping-key request flow", async () => {
    const { GoogleWrappingKeyIssuer, post } = await handlerContext();
    const issuer = wrappingKeyIssuer(GoogleWrappingKeyIssuer, async () => Result.ok("opaque-key"));
    const fromEnvironment = vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment").mockReturnValue(issuer);

    await Promise.all([
      post(jsonRequest({ googleIdToken: "first-id-token" })),
      post(jsonRequest({ googleIdToken: "second-id-token" })),
    ]);

    expect(fromEnvironment).toHaveBeenCalledOnce();
  });

  it("retries composition after a factory failure", async () => {
    const { GoogleWrappingKeyIssuer, LOGGER, post } = await handlerContext();
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const issuer = wrappingKeyIssuer(GoogleWrappingKeyIssuer, async () => Result.ok("opaque-key"));
    const fromEnvironment = vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment")
      .mockImplementationOnce(() => {
        throw new Error("configuration temporarily unavailable");
      })
      .mockReturnValue(issuer);

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
    const { GoogleWrappingKeyIssuer, LOGGER, post } = await handlerContext();
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const issuer = wrappingKeyIssuer(GoogleWrappingKeyIssuer, async () => {
      throw new Error("SECRET-GOOGLE-ID-TOKEN");
    });
    vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment").mockReturnValue(issuer);

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

async function postHandler(issueGoogleWrappingKey: GoogleWrappingKeyIssuer["issueGoogleWrappingKey"]) {
  const { GoogleWrappingKeyIssuer, post } = await handlerContext();
  const issuer = wrappingKeyIssuer(GoogleWrappingKeyIssuer, issueGoogleWrappingKey);
  vi.spyOn(GoogleWrappingKeyIssuer, "fromEnvironment").mockReturnValue(issuer);
  return post;
}

function wrappingKeyIssuer(
  Issuer: typeof GoogleWrappingKeyIssuer,
  issueGoogleWrappingKey: GoogleWrappingKeyIssuer["issueGoogleWrappingKey"],
): GoogleWrappingKeyIssuer {
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("HOMEGATE_URL", "https://homegate.example/");
  vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
  vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", Buffer.alloc(32, 1).toString("base64"));
  const issuer = Issuer.fromEnvironment();
  vi.spyOn(issuer, "issueGoogleWrappingKey").mockImplementation(issueGoogleWrappingKey);
  return issuer;
}

async function handlerContext() {
  vi.resetModules();
  const { LOGGER } = await import("../../../../libs/logger/logger");
  const { GoogleWrappingKeyIssuer } = await import("../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer");
  const { googleWrappingKeyPost: post } = await import("./handler");
  return { GoogleWrappingKeyIssuer, LOGGER, post };
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
