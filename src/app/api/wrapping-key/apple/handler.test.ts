import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type { AppleWrappingKeyIssuer } from "@/server/wrapping-key/apple/AppleWrappingKeyIssuer";

type Issue = AppleWrappingKeyIssuer["issueWrappingKey"];

describe("POST /api/wrapping-key/apple", () => {
  afterEach(() => {
    vi.doUnmock("@/server/wrapping-key/apple/AppleWrappingKeyIssuer");
    vi.restoreAllMocks();
  });

  it("returns the wrapping key for a verified Apple ID token", async () => {
    const issue = vi.fn<Issue>(async () => Result.ok({ wrappingKey: "opaque", keyId: "current" }));
    const post = await handlerWithFactory(() => ({ issueWrappingKey: issue }));

    const response = await post(jsonRequest({ appleIdToken: "id-token", keyId: "old" }));

    expect(await summary(response)).toEqual({
      status: 200,
      body: { wrappingKey: "opaque", keyId: "current" },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(issue).toHaveBeenCalledWith("id-token", "old");
  });

  it("answers 404 while Apple login is off", async () => {
    const post = await handlerWithFactory(() => null);

    expect(await summary(await post(jsonRequest({ appleIdToken: "id-token" })))).toEqual({
      status: 404,
      body: { error: { code: "provider_disabled" } },
    });
  });

  it.each([
    [{ googleIdToken: "id-token" }],
    [{ appleIdToken: "id-token", code: "authorization-code" }],
    [{ appleIdToken: "id-token", name: "Jane Appleseed" }],
    [{ appleIdToken: "id-token", email: "jane@example.com" }],
    [{ appleIdToken: "id-token", user: { name: { firstName: "Jane" } } }],
    [{ appleIdToken: "" }],
  ])("rejects other request shapes without composing the issuer", async (body) => {
    const factory = vi.fn(() => null);
    const post = await handlerWithFactory(factory);

    expect(await summary(await post(jsonRequest(body)))).toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_apple_id_token", 401],
    ["key_unavailable", 409],
    ["apple_verifier_unavailable", 503],
    ["key_derivation_failed", 500],
  ] as const)("maps %s to HTTP %i", async (code, status) => {
    const post = await handlerWithFactory(() => ({
      issueWrappingKey: async () => Result.err({ code, cause: new Error("SECRET") }),
    }));

    const response = await post(jsonRequest({ appleIdToken: "id-token" }));
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(JSON.parse(text)).toEqual({ error: { code } });
    expect(text).not.toContain("SECRET");
  });
});

async function handlerWithFactory(factory: () => { issueWrappingKey: Issue } | null) {
  vi.resetModules();
  vi.doMock("@/server/wrapping-key/apple/AppleWrappingKeyIssuer", async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/server/wrapping-key/apple/AppleWrappingKeyIssuer")
    >()),
    AppleWrappingKeyIssuer: class {
      static fromEnvironment() {
        return factory();
      }
    },
  }));
  return (await import("./handler")).appleWrappingKeyPost;
}

function jsonRequest(body: unknown): Request {
  return new Request("https://passport.pubky.app/api/wrapping-key/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function summary(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}
