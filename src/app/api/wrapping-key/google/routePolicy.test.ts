import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../../../../../test-utils/resultAssertions";
import { parseGoogleIdTokenRequest } from "./routePolicy";

describe("Google wrapping-key route policy", () => {
  it("accepts an exact non-empty field with JSON parameters", async () => {
    const result = await parseGoogleIdTokenRequest(
      jsonRequest({ googleIdToken: "id-token" }, "application/json; charset=utf-8"),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual({ googleIdToken: "id-token" });
    }
  });

  it.each([
    ["text/plain", { googleIdToken: "id-token" }],
    ["application/json", {}],
    ["application/json", { googleIdToken: 123 }],
    ["application/json", { googleIdToken: "   " }],
    ["application/json", { googleIdToken: "id-token", driveAccessToken: "token" }],
    ["application/json", { googleIdToken: "id-token", keyId: "invalid key" }],
    ["application/json", ["id-token"]],
    ["application/json", null],
  ])("rejects invalid request shape", async (contentType, body) => {
    await expectAsyncResultError(parseGoogleIdTokenRequest(jsonRequest(body, contentType)), {
      code: "invalid_request",
    });
  });

  it("accepts a public key ID for an existing file", async () => {
    const result = await parseGoogleIdTokenRequest(
      jsonRequest(
        {
          googleIdToken: "id-token",
          keyId: "2026-08",
        },
        "application/json",
      ),
    );

    expect(Result.isOk(result) && result.value).toEqual({
      googleIdToken: "id-token",
      keyId: "2026-08",
    });
  });

  it("rejects malformed JSON", async () => {
    await expectAsyncResultError(parseGoogleIdTokenRequest(requestWithBody("not json")), {
      code: "invalid_request",
    });
  });

  it("rejects oversized bodies before parsing", async () => {
    await expectAsyncResultError(
      parseGoogleIdTokenRequest(
        requestWithBody("{}", {
          "Content-Type": "application/json",
          "Content-Length": String(16 * 1024 + 1),
        }),
      ),
      { code: "invalid_request" },
    );
  });

  it("preserves an operational request-stream failure", async () => {
    const streamFailure = new TypeError("TOKEN-BEARING-STREAM-FAILURE");
    const result = await parseGoogleIdTokenRequest(requestWithFailingBody(streamFailure));

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({
        code: "invalid_request",
        cause: expect.objectContaining({ cause: streamFailure }),
      });
      expect(JSON.stringify(result.error)).not.toContain("TOKEN-BEARING-STREAM-FAILURE");
    }
  });

  it("does not retain token-bearing JSON parser details", async () => {
    const tokenFragment = "TOKEN-PARSER-CANARY";
    const result = await parseGoogleIdTokenRequest(
      requestWithBody(`{\"googleIdToken\":\"${tokenFragment}`),
    );

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_request" });
    expect(JSON.stringify(result)).not.toContain(tokenFragment);
  });
});

function jsonRequest(body: unknown, contentType: string): Request {
  return requestWithBody(JSON.stringify(body), { "Content-Type": contentType });
}

function requestWithBody(
  body: BodyInit,
  headers: HeadersInit = { "Content-Type": "application/json" },
): Request {
  return new Request("https://passport.pubky.app/api/wrapping-key/google", {
    method: "POST",
    headers,
    body,
  });
}

function requestWithFailingBody(error: Error): Request {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(error);
    },
  });
  return new Request("https://passport.pubky.app/api/wrapping-key/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
}
