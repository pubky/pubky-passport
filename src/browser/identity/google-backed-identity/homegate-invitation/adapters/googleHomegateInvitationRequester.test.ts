import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleHomegateInvitationRequesterErrorCode } from "../application/homegateInvitation";
import { BrowserGoogleHomegateInvitationRequester } from "./googleHomegateInvitationRequester";

const homegateBaseUrl = "https://homegate.example/";
const homegateErrorCases = [
  ["invalid_request", "homegate_invalid_request"],
  ["invalid_google_id_token", "invalid_google_id_token"],
  ["weekly_limit_exceeded", "weekly_limit_exceeded"],
  ["annual_limit_exceeded", "annual_limit_exceeded"],
  ["homeserver_unavailable", "homeserver_unavailable"],
  ["google_verifier_unavailable", "google_verifier_unavailable"],
  ["internal_error", "homegate_unavailable"],
  ["unknown error containing SECRET-GOOGLE-ID-TOKEN", "malformed_homegate_response"],
] satisfies ReadonlyArray<readonly [string, GoogleHomegateInvitationRequesterErrorCode]>;
const malformedSuccessCases = [
  ["an unknown field", () => jsonResponse({ signupCode: "code", homeserverPubky: "home", extra: "unsafe" })],
  ["an empty signup code", () => jsonResponse({ signupCode: "", homeserverPubky: "home" })],
  ["an oversized signup code", () => jsonResponse({ signupCode: "x".repeat(1025), homeserverPubky: "home" })],
  ["an empty homeserver public key", () => jsonResponse({ signupCode: "code", homeserverPubky: "" })],
  ["an oversized homeserver public key", () => jsonResponse({ signupCode: "code", homeserverPubky: "x".repeat(1025) })],
  ["a non-string field", () => jsonResponse({ signupCode: 42, homeserverPubky: "home" })],
  ["invalid JSON", () => new Response("not-json", { status: 200 })],
  ["an oversized body", () => new Response("x".repeat(16 * 1024 + 1), { status: 200 })],
] satisfies ReadonlyArray<readonly [string, () => Response]>;

describe("BrowserGoogleHomegateInvitationRequester", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts only the Google ID token directly to Homegate", async () => {
    const requestSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(requestSignal);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      signupCode: "signup-code",
      homeserverPubky: "homeserver-pubky",
    }));
    const requester = new BrowserGoogleHomegateInvitationRequester({ fetch, homegateBaseUrl });

    const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

    expect(result).toEqual(Result.ok({
      signupCode: "signup-code",
      homeserverPubky: "homeserver-pubky",
    }));
    expect(fetch).toHaveBeenCalledOnce();
    const call = fetch.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected Homegate request.");
    const [url, init] = call;
    expect(String(url)).toBe("https://homegate.example/google_verification");
    expect(init).toMatchObject({
      method: "POST",
      headers: { Accept: "application/json, text/plain", "Content-Type": "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(init?.signal).toBe(requestSignal);
    expect(JSON.parse(String(init?.body))).toEqual({ googleIdToken: "id-token" });
  });

  it("appends the endpoint to the normalized Homegate base path", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      signupCode: "signup-code",
      homeserverPubky: "homeserver-pubky",
    }));
    const requester = new BrowserGoogleHomegateInvitationRequester({
      fetch,
      homegateBaseUrl: "https://homegate.example/api/",
    });

    await requester.requestSignupInvitation({ googleIdToken: "id-token" });

    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://homegate.example/api/google_verification");
  });

  it.each(["", "   ", "x".repeat(16 * 1024 + 1)])(
    "rejects an invalid Google ID token before contacting Homegate",
    async (googleIdToken) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const requester = new BrowserGoogleHomegateInvitationRequester({ fetch, homegateBaseUrl });

      const result = await requester.requestSignupInvitation({ googleIdToken });

      expect(fetch).not.toHaveBeenCalled();
      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("Expected invalid token failure.");
      expect(result.error).toEqual({ code: "homegate_invalid_request" });
    },
  );

  it.each(malformedSuccessCases)("rejects a success response with %s", async (_name, response) => {
    const requester = new BrowserGoogleHomegateInvitationRequester({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response()),
      homegateBaseUrl,
    });

    const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected malformed Homegate response failure.");
    expect(result.error).toEqual({ code: "malformed_homegate_response" });
  });

  it("maps an error-body stream failure to Homegate unavailable", async () => {
    const requestController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(requestController.signal);
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.error(new Error("upstream body failed"));
      },
    }), { status: 500 });
    const requester = new BrowserGoogleHomegateInvitationRequester({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
      homegateBaseUrl,
    });

    const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

    expect(requestController.signal.aborted).toBe(false);
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected unavailable Homegate failure.");
    expect(result.error).toEqual({ code: "homegate_unavailable" });
  });

  it.each(homegateErrorCases)("maps Homegate plaintext error %s to %s", async (body, expectedCode) => {
    const requester = new BrowserGoogleHomegateInvitationRequester({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, { status: 500 })),
      homegateBaseUrl,
    });

    const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected mapped Homegate failure.");
    expect(result.error).toEqual({ code: expectedCode });
  });

  it("maps absent and oversized Homegate error bodies to unavailable", async () => {
    for (const response of [
      new Response(null, { status: 500 }),
      new Response("x".repeat(257), { status: 500 }),
    ]) {
      const requester = new BrowserGoogleHomegateInvitationRequester({
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
        homegateBaseUrl,
      });

      const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("Expected unavailable Homegate failure.");
      expect(result.error).toEqual({ code: "homegate_unavailable" });
    }
  });

  it("maps network failures without leaking the Google ID token", async () => {
    const requester = new BrowserGoogleHomegateInvitationRequester({
      fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("SECRET-GOOGLE-ID-TOKEN")),
      homegateBaseUrl,
    });

    const result = await requester.requestSignupInvitation({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" });

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Homegate network failure.");
    expect(result.error).toEqual({ code: "network_failed" });
  });

  it("maps timeout setup failures to a network failure", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      throw new Error("unsupported");
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const requester = new BrowserGoogleHomegateInvitationRequester({ fetch, homegateBaseUrl });

    const result = await requester.requestSignupInvitation({ googleIdToken: "id-token" });

    expect(fetch).not.toHaveBeenCalled();
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Homegate network failure.");
    expect(result.error).toEqual({ code: "network_failed" });
  });

  it("maps a timeout while reading the response body to a network failure", async () => {
    const requestController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(requestController.signal);
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) =>
      Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("timed out")));
        },
      })))
    );
    const requester = new BrowserGoogleHomegateInvitationRequester({ fetch, homegateBaseUrl });

    const resultPromise = requester.requestSignupInvitation({ googleIdToken: "id-token" });
    requestController.abort();

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Homegate timeout failure.");
    expect(result.error).toEqual({ code: "network_failed" });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
