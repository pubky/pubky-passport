import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "@test-utils/resultAssertions";
import { parseGoogleIdTokenRequest } from "./routePolicy";

const PREIMAGE = Buffer.alloc(32, 9).toString("base64url");

describe("Google wrapping-key route policy", () => {
  it("accepts exact non-empty fields with JSON parameters", async () => {
    const result = await parseGoogleIdTokenRequest(
      jsonRequest(
        { googleIdToken: "id-token", googleNoncePreimage: PREIMAGE },
        "application/json; charset=utf-8",
      ),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual({ googleIdToken: "id-token", googleNoncePreimage: PREIMAGE });
    }
  });

  it("tells a page loaded before the preimage existed to reload, not that it failed", async () => {
    await expectAsyncResultError(
      parseGoogleIdTokenRequest(jsonRequest({ googleIdToken: "id-token" }, "application/json")),
      { code: "reload_required" },
    );
    await expectAsyncResultError(
      parseGoogleIdTokenRequest(
        jsonRequest({ googleIdToken: "id-token", keyId: "2026-08" }, "application/json"),
      ),
      { code: "reload_required" },
    );
  });

  it.each([
    ["text/plain", { googleIdToken: "id-token", googleNoncePreimage: PREIMAGE }],
    ["application/json", {}],
    ["application/json", { googleNoncePreimage: PREIMAGE }],
    ["application/json", { googleIdToken: 123, googleNoncePreimage: PREIMAGE }],
    ["application/json", { googleIdToken: "   ", googleNoncePreimage: PREIMAGE }],
    [
      "application/json",
      { googleIdToken: "id-token", googleNoncePreimage: PREIMAGE, driveAccessToken: "token" },
    ],
    [
      "application/json",
      { googleIdToken: "id-token", googleNoncePreimage: PREIMAGE, keyId: "invalid key" },
    ],
    // The preimage is 32 bytes in canonical base64url: 43 characters, nothing else.
    ["application/json", { googleIdToken: "id-token", googleNoncePreimage: "" }],
    ["application/json", { googleIdToken: "id-token", googleNoncePreimage: PREIMAGE.slice(1) }],
    ["application/json", { googleIdToken: "id-token", googleNoncePreimage: `${PREIMAGE}A` }],
    ["application/json", { googleIdToken: "id-token", googleNoncePreimage: `${"A".repeat(42)}B` }],
    ["application/json", { googleIdToken: "id-token", googleNoncePreimage: 32 }],
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
          googleNoncePreimage: PREIMAGE,
          keyId: "2026-08",
        },
        "application/json",
      ),
    );

    expect(Result.isOk(result) && result.value).toEqual({
      googleIdToken: "id-token",
      googleNoncePreimage: PREIMAGE,
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
