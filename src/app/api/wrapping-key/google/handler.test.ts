import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type { GoogleWrappingKeyIssuer } from "../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer";

describe("POST /api/wrapping-key/google", () => {
  afterEach(() => {
    vi.doUnmock("../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer");
    vi.restoreAllMocks();
  });

  it("returns legacy and versioned wrapping-key results", async () => {
    const legacyPost = await postHandler(async () => Result.ok({ wrappingKey: "opaque-key" }));
    const legacy = await legacyPost(jsonRequest({ googleIdToken: "id-token" }));
    expect(await responseSummary(legacy)).toEqual({
      status: 200,
      body: { wrappingKey: "opaque-key" },
    });
    expect(legacy.headers.get("Cache-Control")).toBe("no-store");

    const versionedPost = await postHandler(async (_token, keyId) => Result.ok({
      wrappingKey: "rotated-key",
      keyId: keyId ?? "current",
    }));
    await expect(versionedPost(jsonRequest({ googleIdToken: "id-token", keyId: "old" }))
      .then(responseSummary)).resolves.toEqual({
        status: 200,
        body: { wrappingKey: "rotated-key", keyId: "old" },
      });
  });

  it("does not construct dependencies for invalid requests", async () => {
    const factory = vi.fn(() => issuer(async () => Result.ok({ wrappingKey: "opaque-key" })));
    const post = await handlerWithFactory(factory);

    const response = await post(jsonRequest({}));

    expect(await responseSummary(response)).toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_google_id_token", 401],
    ["key_unavailable", 409],
    ["dependency_unavailable", 503],
  ] as const)("maps %s failures to HTTP %i", async (code, status) => {
    const post = await postHandler(async () => Result.err({ code }));

    await expect(post(jsonRequest({ googleIdToken: "id-token" })).then(responseSummary))
      .resolves.toEqual({ status, body: { error: { code } } });
  });

  it("never serializes an internal failure cause", async () => {
    const post = await postHandler(async () => Result.err({
      code: "dependency_unavailable" as const,
      cause: new Error("SECRET-GOOGLE-ID-TOKEN"),
    }));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));
    const responseText = await response.text();
    expect(response.status).toBe(503);
    expect(responseText).not.toContain("cause");
    expect(responseText).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("reuses the configured issuer", async () => {
    const factory = vi.fn(() => issuer(async () => Result.ok({ wrappingKey: "opaque-key" })));
    const post = await handlerWithFactory(factory);

    await post(jsonRequest({ googleIdToken: "first" }));
    await post(jsonRequest({ googleIdToken: "second" }));

    expect(factory).toHaveBeenCalledOnce();
  });

  it("retries composition after a factory failure", async () => {
    const factory = vi.fn()
      .mockImplementationOnce(() => { throw new Error("temporarily unavailable"); })
      .mockReturnValue(issuer(async () => Result.ok({ wrappingKey: "opaque-key" })));
    const post = await handlerWithFactory(factory);

    expect((await post(jsonRequest({ googleIdToken: "first" }))).status).toBe(500);
    expect((await post(jsonRequest({ googleIdToken: "second" }))).status).toBe(200);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("maps unexpected issuer failures to a safe response", async () => {
    const post = await postHandler(async () => {
      throw new Error("SECRET-GOOGLE-ID-TOKEN");
    });

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));
    expect(await responseSummary(response)).toEqual({
      status: 500,
      body: { error: { code: "internal_error" } },
    });
  });
});

async function postHandler(
  issueGoogleWrappingKey: GoogleWrappingKeyIssuer["issueGoogleWrappingKey"],
) {
  return handlerWithFactory(() => issuer(issueGoogleWrappingKey));
}

async function handlerWithFactory(factory: () => GoogleWrappingKeyIssuer) {
  vi.resetModules();
  vi.doMock("../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer")>(),
    createGoogleWrappingKeyIssuerFromEnvironment: factory,
  }));
  return (await import("./handler")).googleWrappingKeyPost;
}

function issuer(
  issueGoogleWrappingKey: GoogleWrappingKeyIssuer["issueGoogleWrappingKey"],
): GoogleWrappingKeyIssuer {
  return { issueGoogleWrappingKey };
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
