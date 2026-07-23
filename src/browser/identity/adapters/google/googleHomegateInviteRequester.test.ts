import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { BrowserGoogleHomegateInviteRequester } from "./googleHomegateInviteRequester";

describe("BrowserGoogleHomegateInviteRequester", () => {
  it("posts only the Google ID token to the documented same-origin route", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      signupCode: "signup-code",
      homeserverPubky: "homeserver-pubky",
    }));
    const requester = new BrowserGoogleHomegateInviteRequester({ fetch, origin: "https://passport.pubky.app" });

    const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

    expect(Result.isError(result)).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
    const call = fetch.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected Homegate request.");
    const [url, init] = call;
    expect(String(url)).toBe("https://passport.pubky.app/api/homegate/google/invite");
    expect(JSON.parse(String(init?.body))).toEqual({ googleIdToken: "id-token" });
    expect(String(init?.body)).not.toContain("drive");
  });

  it("rejects unknown, malformed, and oversized success responses", async () => {
    for (const response of [
      jsonResponse({ signupCode: "code", homeserverPubky: "home", extra: "unsafe" }),
      new Response("not-json", { status: 200 }),
      new Response("x".repeat(16 * 1024 + 1), { status: 200 }),
    ]) {
      const requester = new BrowserGoogleHomegateInviteRequester({
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
        origin: "https://passport.pubky.app",
      });

      const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_response" });
    }
  });

  it("accepts only known exact error responses", async () => {
    const known = new BrowserGoogleHomegateInviteRequester({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ error: { code: "weekly_limit_exceeded" } }, 429)),
      origin: "https://passport.pubky.app",
    });
    const unknown = new BrowserGoogleHomegateInviteRequester({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ error: { code: "secret-error" } }, 500)),
      origin: "https://passport.pubky.app",
    });

    const knownResult = await known.requestSignupInvitation({ googleIdToken: "id-token" });
    const unknownResult = await unknown.requestSignupInvitation({ googleIdToken: "id-token" });

    if (Result.isError(knownResult)) expect(knownResult.error).toEqual({ code: "weekly_limit_exceeded" });
    if (Result.isError(unknownResult)) expect(unknownResult.error).toEqual({ code: "invalid_response" });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
