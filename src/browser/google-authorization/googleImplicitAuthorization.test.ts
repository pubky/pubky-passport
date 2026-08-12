// @vitest-environment jsdom

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeBase64Url } from "../../libs/encoding/base64Url";
import { GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE } from "../../libs/authorization/earlyGoogleImplicitResponse";
import { GoogleImplicitAuthorization } from "./googleImplicitAuthorization";

const ORIGIN = "https://passport.example";
const SUBJECT = "google-subject";
const ACCESS_TOKEN = "drive-access-token-canary";
const APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_RETURNED_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  APP_DATA_SCOPE,
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

describe("GoogleImplicitAuthorization", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("opens one implicit OAuth request and returns account-bound credentials", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    const open = vi.fn<typeof window.open>(() => popup.window);
    const fetch = vi.fn(async () => Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }));
    const authorization = new GoogleImplicitAuthorization({ clientId: "client-id", origin: ORIGIN, open, fetch });

    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authorizeUrl.searchParams.get("response_type")).toBe("id_token token");
    expect(authorizeUrl.searchParams.get("scope")).toContain(APP_DATA_SCOPE);
    expect(authorizeUrl.searchParams.get("include_granted_scopes")).toBe("false");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(ORIGIN);
    const nonce = authorizeUrl.searchParams.get("nonce");
    const state = authorizeUrl.searchParams.get("state");
    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce }),
      scope: GOOGLE_RETURNED_SCOPES,
      state: state ?? "",
    })}`);
    await vi.advanceTimersByTimeAsync(200);

    await expect(request).resolves.toEqual(Result.ok({
      googleIdToken: jwt({ sub: SUBJECT, nonce }),
      driveAccessToken: ACCESS_TOKEN,
      googleAccount: { id: SUBJECT, email: "person@example.com", name: "Person", pictureUrl: null },
    }));
    expect(fetch).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", expect.objectContaining({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }));
    expect(popup.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(localStorage)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(sessionStorage)).not.toContain(ACCESS_TOKEN);
  });

  it("reports popup closure from the popup handle", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    const authorization = new GoogleImplicitAuthorization({
      clientId: "client-id",
      origin: ORIGIN,
      open: () => popup.window,
    });
    const request = authorization.request();

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(200);

    const result = await request;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.code).toBe("google_authorization_popup_closed");
  });

  it("rejects state, nonce, scope, and account mismatches", async () => {
    vi.useFakeTimers();
    for (const scenario of ["state", "nonce", "scope", "subject"] as const) {
      const popup = createPopup();
      const open = vi.fn<typeof window.open>(() => popup.window);
      const fetch = vi.fn(async () => Response.json({
        sub: scenario === "subject" ? "different-subject" : SUBJECT,
        email: "person@example.com",
        name: "Person",
      }));
      const authorization = new GoogleImplicitAuthorization({ clientId: "client-id", origin: ORIGIN, open, fetch });
      const request = authorization.request();
      const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
      const nonce = authorizeUrl.searchParams.get("nonce");
      const state = authorizeUrl.searchParams.get("state");
      popup.returnTo(`${ORIGIN}/#${new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce: scenario === "nonce" ? "wrong" : nonce }),
        scope: scenario === "scope" ? "openid" : APP_DATA_SCOPE,
        state: scenario === "state" ? "wrong" : state ?? "",
      })}`);
      await vi.advanceTimersByTimeAsync(200);
      const result = await request;
      expect(Result.isError(result)).toBe(true);
    }
  });

  it("rejects duplicate response fields and unexpected scopes", async () => {
    vi.useFakeTimers();
    for (const fragmentSuffix of [
      `&state=duplicate`,
      `&scope=${encodeURIComponent("https://www.googleapis.com/auth/drive")}`,
    ]) {
      const popup = createPopup();
      const open = vi.fn<typeof window.open>(() => popup.window);
      const authorization = new GoogleImplicitAuthorization({ clientId: "client-id", origin: ORIGIN, open });
      const request = authorization.request();
      const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
      const fragment = new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
        scope: APP_DATA_SCOPE,
        state: authorizeUrl.searchParams.get("state") ?? "",
      });
      popup.returnTo(`${ORIGIN}/#${fragment}${fragmentSuffix}`);
      const result = await request;
      expect(Result.isError(result)).toBe(true);
    }
  });

  it("times out and aborts in-flight account verification", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    const open = vi.fn<typeof window.open>(() => popup.window);
    let fetchSignal: AbortSignal | null = null;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      fetchSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const authorization = new GoogleImplicitAuthorization({ clientId: "client-id", origin: ORIGIN, open, fetch });
    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      scope: APP_DATA_SCOPE,
      state: authorizeUrl.searchParams.get("state") ?? "",
    })}`);
    await vi.waitFor(() => expect(fetchSignal).not.toBeNull());

    authorization.dispose();

    const result = await request;
    expect(Result.isError(result)).toBe(true);
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("reports a blocked popup without starting an attempt", async () => {
    const authorization = new GoogleImplicitAuthorization({ clientId: "client-id", origin: ORIGIN, open: () => null });
    const result = await authorization.request();
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.code).toBe("google_authorization_popup_failed_to_open");
  });
});

function createPopup() {
  let closed = false;
  let href = "https://accounts.google.com/o/oauth2/v2/auth";
  const close = vi.fn(() => { closed = true; });
  const popup = {
    get closed() { return closed; },
    set closed(value: boolean) { closed = value; },
    location: {
      get href() { return href; },
      get origin() { return new URL(href).origin; },
      get pathname() { return new URL(href).pathname; },
    },
    close,
  } as unknown as Window;
  return {
    window: popup,
    close,
    get closed() { return closed; },
    set closed(value: boolean) { closed = value; },
    returnTo(value: string) {
      const url = new URL(value);
      href = `${url.origin}/`;
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE, status: "captured", hash: url.hash },
        origin: url.origin,
        source: popup,
      }));
    },
  };
}

function jwt(payload: unknown): string {
  return `eyJhbGciOiJub25lIn0.${encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}.signature`;
}
