import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpResponseError } from "../../../../libs/http/HttpResponseError";
import { fetchGoogleAccountProfile } from "./fetchGoogleAccountProfile";

describe("fetchGoogleAccountProfile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retains a non-success status and bounded response body as its cause", async () => {
    const responseBody = JSON.stringify({ error: "userinfo_forbidden" });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => {
        return new Response(responseBody, { status: 403, statusText: "Forbidden" });
      }),
    );

    const result = await fetchGoogleAccountProfile(
      "access-token",
      "google-subject",
      new AbortController().signal,
    );

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Google UserInfo failure.");
    expect(result.error).toMatchObject({
      code: "google_authorization_failed",
      stage: "error_response",
      httpStatus: 403,
      cause: expect.any(HttpResponseError),
    });
    expect(result.error.cause).toMatchObject({
      status: 403,
      statusText: "Forbidden",
      responseBody,
    });
    expect(JSON.stringify(result)).not.toContain("userinfo_forbidden");
  });

  it("chains the JSON parser exception without retaining a successful response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => {
        return new Response("{not-json", { status: 200 });
      }),
    );

    const result = await fetchGoogleAccountProfile(
      "access-token",
      "google-subject",
      new AbortController().signal,
    );

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Google UserInfo parse failure.");
    expect(result.error).toMatchObject({
      code: "google_authorization_failed",
      stage: "response_parse",
      cause: expect.any(Error),
    });
    expect((result.error.cause as Error).cause).toBeInstanceOf(SyntaxError);
  });
});
