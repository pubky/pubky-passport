import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { parseGoogleIdTokenRequest } from "./googleCredentialRoutePolicy";

describe("Google credential route policy", () => {
  it("accepts an exact non-empty field with JSON parameters", async () => {
    const result = await parseGoogleIdTokenRequest(
      jsonRequest({ googleIdToken: "id-token" }, "application/json; charset=utf-8"),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toBe("id-token");
    }
  });

  it.each([
    ["text/plain", { googleIdToken: "id-token" }],
    ["application/json", {}],
    ["application/json", { googleIdToken: "   " }],
    ["application/json", { googleIdToken: "id-token", driveAccessToken: "token" }],
    ["application/json", ["id-token"]],
  ])("rejects invalid request shape", async (contentType, body) => {
    const result = await parseGoogleIdTokenRequest(
      jsonRequest(body, contentType),
    );

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toBe("invalid_request");
    }
  });
});

function jsonRequest(body: unknown, contentType: string): Request {
  return new Request("https://passport.pubky.app/api/wrapping-key/google", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}
