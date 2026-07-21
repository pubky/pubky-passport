import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { createHomegateInvitePostHandler } from "./handler";
import type {
  GoogleHomegateInvite,
  GoogleHomegateInviteResult,
} from "../../../../server/homegate/google/invite";

const invite = {
  signupCode: "signup-code",
  homeserverPubky: "homegate-returned-homeserver-pubky",
};

describe("POST /api/homegate/google-invite", () => {
  it("maps valid Homegate results to HTTP success", async () => {
    const post = createHomegateInvitePostHandler(homegateInvite(Result.ok(invite)));

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(invite);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("rejects malformed JSON with a safe 400", async () => {
    const post = createHomegateInvitePostHandler(homegateInvite(Result.ok(invite)));

    const response = await post(
      new Request("http://localhost/api/homegate/google-invite", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("requires an application/json content type", async () => {
    const post = createHomegateInvitePostHandler(homegateInvite(Result.ok(invite)));

    const response = await post(new Request("http://localhost/api/homegate/google-invite", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ googleIdToken: "id-token" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
  });

  it("rejects oversized request bodies before calling Homegate", async () => {
    let inviteCalls = 0;
    const post = createHomegateInvitePostHandler({
      async requestInvite() {
        inviteCalls += 1;
        return Result.ok(invite);
      },
    });

    const response = await post(oversizedRequest("http://localhost/api/homegate/google-invite"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(inviteCalls).toBe(0);
  });

  it("rejects missing, non-string, and empty tokens", async () => {
    const post = createHomegateInvitePostHandler(homegateInvite(Result.ok(invite)));

    await expect(post(jsonRequest({})).then(responseSummary)).resolves.toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    await expect(post(jsonRequest({ googleIdToken: 123 })).then(responseSummary)).resolves.toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    await expect(post(jsonRequest({ googleIdToken: "   " })).then(responseSummary)).resolves.toEqual({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("rejects unknown fields so Drive and key material cannot be sent", async () => {
    let inviteCalls = 0;
    const post = createHomegateInvitePostHandler({
      async requestInvite() {
        inviteCalls += 1;
        return Result.ok(invite);
      },
    });

    const response = await post(
      jsonRequest({
        googleIdToken: "id-token",
        driveAccessToken: "drive-token",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request" } });
    expect(inviteCalls).toBe(0);
  });

  it("maps expected Homegate failures to fixed HTTP statuses", async () => {
    await expect(
      createHomegateInvitePostHandler(homegateInvite(Result.err({ code: "invalid_google_id_token" })))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 401, body: { error: { code: "invalid_google_id_token" } } });

    await expect(
      createHomegateInvitePostHandler(homegateInvite(Result.err({ code: "weekly_limit_exceeded" })))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 429, body: { error: { code: "weekly_limit_exceeded" } } });

    await expect(
      createHomegateInvitePostHandler(homegateInvite(Result.err({ code: "malformed_homegate_response" })))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 502, body: { error: { code: "malformed_homegate_response" } } });

    await expect(
      createHomegateInvitePostHandler(homegateInvite(Result.err({ code: "homegate_unavailable" })))(
        jsonRequest({ googleIdToken: "id-token" }),
      ).then(responseSummary),
    ).resolves.toEqual({ status: 503, body: { error: { code: "homegate_unavailable" } } });
  });

  it("maps unexpected Homegate failures to safe 500 responses", async () => {
    const post = createHomegateInvitePostHandler({
      async requestInvite() {
        throw new Error("token must not leak");
      },
    });

    const response = await post(jsonRequest({ googleIdToken: "id-token" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "internal_error" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

function homegateInvite(result: GoogleHomegateInviteResult): GoogleHomegateInvite {
  return {
    async requestInvite() {
      return result;
    },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/homegate/google-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function oversizedRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Length": String(16 * 1024 + 1) },
    body: "{}",
  });
}

async function responseSummary(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}
