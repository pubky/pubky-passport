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
    await expectAsyncResultError(
      parseGoogleIdTokenRequest(jsonRequest(body, contentType)),
      "invalid_request",
    );
  });

  it("accepts a public key ID for v2 files", async () => {
    const result = await parseGoogleIdTokenRequest(jsonRequest({
      googleIdToken: "id-token",
      keyId: "2026-08",
    }, "application/json"));

    expect(Result.isOk(result) && result.value).toEqual({
      googleIdToken: "id-token",
      keyId: "2026-08",
    });
  });

  it("rejects malformed JSON", async () => {
    await expectAsyncResultError(
      parseGoogleIdTokenRequest(requestWithBody("not json")),
      "invalid_request",
    );
  });

  it("rejects oversized bodies before parsing", async () => {
    await expectAsyncResultError(
      parseGoogleIdTokenRequest(requestWithBody("{}", {
        "Content-Type": "application/json",
        "Content-Length": String(16 * 1024 + 1),
      })),
      "invalid_request",
    );
  });
});

function jsonRequest(body: unknown, contentType: string): Request {
  return requestWithBody(JSON.stringify(body), { "Content-Type": contentType });
}

function requestWithBody(body: BodyInit, headers: HeadersInit = { "Content-Type": "application/json" }): Request {
  return new Request("https://passport.pubky.app/api/wrapping-key/google", {
    method: "POST",
    headers,
    body,
  });
}
