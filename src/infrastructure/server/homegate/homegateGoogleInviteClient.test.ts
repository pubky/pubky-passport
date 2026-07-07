import { describe, expect, it } from "vitest";

import { ServerHomegateGoogleInviteClient } from "./homegateGoogleInviteClient";
import type { HomegateInviteErrorCode } from "../../../core/ports/homegateInvite";

const successBody = {
  signupCode: "signup-code",
  homeserverPubky: "homegate-returned-homeserver-pubky",
};

const homegateErrorCases: Array<{ body: string; code: HomegateInviteErrorCode }> = [
  { body: "invalid_request", code: "homegate_invalid_request" },
  { body: "invalid_google_id_token", code: "invalid_google_id_token" },
  { body: "weekly_limit_exceeded", code: "weekly_limit_exceeded" },
  { body: "annual_limit_exceeded", code: "annual_limit_exceeded" },
  { body: "homeserver_unavailable", code: "homeserver_unavailable" },
  { body: "google_verifier_unavailable", code: "google_verifier_unavailable" },
  { body: "internal_error", code: "homegate_unavailable" },
];

describe("ServerHomegateGoogleInviteClient", () => {
  it("posts Google ID tokens to Homegate google_verification", async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new ServerHomegateGoogleInviteClient({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url: url.toString(), init });
        return jsonResponse(successBody);
      },
    });

    await expect(client.requestGoogleInvite({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" })).resolves.toEqual({
      ok: true,
      value: successBody,
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://homegate.pubky.app/google_verification");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toEqual({
      Accept: "application/json, text/plain",
      "Content-Type": "application/json",
    });
    expect(fetchCalls[0]?.init?.body).toBe(JSON.stringify({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" }));
  });

  it("handles Homegate URLs with trailing slashes", async () => {
    let requestedUrl = "";
    const client = new ServerHomegateGoogleInviteClient({
      homegateUrl: "https://homegate.pubky.app/",
      fetchImpl: async (url) => {
        requestedUrl = url.toString();
        return jsonResponse(successBody);
      },
    });

    await client.requestGoogleInvite({ googleIdToken: "google-id-token" });

    expect(requestedUrl).toBe("https://homegate.pubky.app/google_verification");
  });

  it.each(homegateErrorCases)("maps Homegate $body errors", async ({ body, code }) => {
    const client = new ServerHomegateGoogleInviteClient({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => textResponse(body, { status: 400 }),
    });

    await expect(client.requestGoogleInvite({ googleIdToken: "google-id-token" })).resolves.toEqual({
      ok: false,
      error: { code },
    });
  });

  it("maps network failures to Homegate unavailable without leaking tokens", async () => {
    const client = new ServerHomegateGoogleInviteClient({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => {
        throw new Error("SECRET-GOOGLE-ID-TOKEN should not leak");
      },
    });

    const result = await client.requestGoogleInvite({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" });

    expect(result).toEqual({ ok: false, error: { code: "homegate_unavailable" } });
    expect(JSON.stringify(result)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("maps unknown error bodies to malformed Homegate response without leaking bodies", async () => {
    const client = new ServerHomegateGoogleInviteClient({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => textResponse("unexpected body with SECRET-GOOGLE-ID-TOKEN", { status: 500 }),
    });

    const result = await client.requestGoogleInvite({ googleIdToken: "google-id-token" });

    expect(result).toEqual({ ok: false, error: { code: "malformed_homegate_response" } });
    expect(JSON.stringify(result)).not.toContain("unexpected body");
    expect(JSON.stringify(result)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("maps malformed success JSON to malformed Homegate response", async () => {
    const client = new ServerHomegateGoogleInviteClient({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => textResponse("not json", { status: 200 }),
    });

    await expect(client.requestGoogleInvite({ googleIdToken: "google-id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "malformed_homegate_response" },
    });
  });

  it.each([
    { signupCode: "", homeserverPubky: "homegate-returned-homeserver-pubky" },
    { signupCode: "signup-code", homeserverPubky: "" },
    { signupCode: 123, homeserverPubky: "homegate-returned-homeserver-pubky" },
    { signupCode: "signup-code", homeserverPubky: null },
  ])("rejects malformed success bodies", async (body) => {
    const client = new ServerHomegateGoogleInviteClient({
      homegateUrl: "https://homegate.pubky.app",
      fetchImpl: async () => jsonResponse(body),
    });

    await expect(client.requestGoogleInvite({ googleIdToken: "google-id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "malformed_homegate_response" },
    });
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
