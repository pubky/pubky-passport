import { describe, expect, it } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import { expectAsyncResultError } from "../../../../test-utils/resultAssertions";
import { createGoogleHomegateInvite, type GoogleHomegateInviteErrorCode } from "./invite";

const successBody = {
  signupCode: "signup-code",
  homeserverPubky: "homegate-returned-homeserver-pubky",
};

const homegateErrorCases: Array<{ body: string; code: GoogleHomegateInviteErrorCode }> = [
  { body: "invalid_request", code: "homegate_invalid_request" },
  { body: "invalid_google_id_token", code: "invalid_google_id_token" },
  { body: "weekly_limit_exceeded", code: "weekly_limit_exceeded" },
  { body: "annual_limit_exceeded", code: "annual_limit_exceeded" },
  { body: "homeserver_unavailable", code: "homeserver_unavailable" },
  { body: "google_verifier_unavailable", code: "google_verifier_unavailable" },
  { body: "internal_error", code: "homegate_unavailable" },
];

async function expectError(result: Promise<ResultType<unknown, { code: string }>>, code: string): Promise<void> {
  await expectAsyncResultError(result, { code });
}

describe("Google Homegate invite", () => {
  it("posts Google ID tokens to Homegate google_verification", async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url: url.toString(), init });
        return jsonResponse(successBody);
      },
    });

    await expect(invite.requestSignupInvitation({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" })).resolves.toEqual(Result.ok(successBody));
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://homegate.pubky.app/google_verification");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toEqual({
      Accept: "application/json, text/plain",
      "Content-Type": "application/json",
    });
    expect(fetchCalls[0]?.init?.body).toBe(JSON.stringify({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" }));
    expect(fetchCalls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("handles Homegate URLs with trailing slashes", async () => {
    let requestedUrl = "";
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app/",
      fetchImpl: async (url) => {
        requestedUrl = url.toString();
        return jsonResponse(successBody);
      },
    });

    await invite.requestSignupInvitation({ googleIdToken: "google-id-token" });

    expect(requestedUrl).toBe("https://homegate.pubky.app/google_verification");
  });

  it("preserves an explicitly configured Homegate base path", async () => {
    let requestedUrl = "";
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app/api",
      fetchImpl: async (url) => {
        requestedUrl = url.toString();
        return jsonResponse(successBody);
      },
    });

    await invite.requestSignupInvitation({ googleIdToken: "google-id-token" });

    expect(requestedUrl).toBe("https://homegate.pubky.app/api/google_verification");
  });

  it.each([
    "https://homegate.pubky.app?unexpected=true",
    "https://homegate.pubky.app#fragment",
    "https://user:password@homegate.pubky.app",
  ])("rejects unsafe Homegate base URL metadata", (homegateUrl) => {
    expect(() => createGoogleHomegateInvite({ homegateUrl })).toThrow("Invalid Homegate URL configuration.");
  });

  it.each(homegateErrorCases)("maps Homegate $body errors", async ({ body, code }) => {
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => textResponse(body, { status: 400 }),
    });

    await expectError(invite.requestSignupInvitation({ googleIdToken: "google-id-token" }), code);
  });

  it("maps network failures to Homegate unavailable without leaking tokens", async () => {
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => {
        throw new Error("SECRET-GOOGLE-ID-TOKEN should not leak");
      },
    });

    const result = await invite.requestSignupInvitation({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "homegate_unavailable" });
    }
    expect(JSON.stringify(result)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("maps unknown error bodies to malformed Homegate response without leaking bodies", async () => {
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => textResponse("unexpected body with SECRET-GOOGLE-ID-TOKEN", { status: 500 }),
    });

    const result = await invite.requestSignupInvitation({ googleIdToken: "google-id-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "malformed_homegate_response" });
    }
    expect(JSON.stringify(result)).not.toContain("unexpected body");
    expect(JSON.stringify(result)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("maps malformed success JSON to malformed Homegate response", async () => {
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => textResponse("not json", { status: 200 }),
    });

    await expectError(invite.requestSignupInvitation({ googleIdToken: "google-id-token" }), "malformed_homegate_response");
  });

  it("rejects oversized Homegate success bodies", async () => {
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => oversizedResponse(200),
    });

    await expectError(invite.requestSignupInvitation({ googleIdToken: "google-id-token" }), "malformed_homegate_response");
  });

  it("rejects oversized Homegate error bodies", async () => {
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => oversizedResponse(500),
    });

    await expectError(invite.requestSignupInvitation({ googleIdToken: "google-id-token" }), "homegate_unavailable");
  });

  it.each([
    { signupCode: "", homeserverPubky: "homegate-returned-homeserver-pubky" },
    { signupCode: "signup-code", homeserverPubky: "" },
    { signupCode: 123, homeserverPubky: "homegate-returned-homeserver-pubky" },
    { signupCode: "signup-code", homeserverPubky: null },
  ])("rejects malformed success bodies", async (body) => {
    const invite = createGoogleHomegateInvite({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => jsonResponse(body),
    });

    await expectError(invite.requestSignupInvitation({ googleIdToken: "google-id-token" }), "malformed_homegate_response");
  });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function textResponse(body: string, init: ResponseInit): Response {
  return new Response(body, init);
}

function oversizedResponse(status: number): Response {
  return new Response("ignored", {
    status,
    headers: { "Content-Length": String(16 * 1024 + 1) },
  });
}
