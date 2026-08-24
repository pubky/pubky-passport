// @vitest-environment jsdom

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/MemoryStorage";
import { encodeBase64Url } from "../../../libs/encoding/base64Url";
import { GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE } from "../../../libs/authorization/earlyGoogleImplicitResponse";
import { LOGGER } from "../../../libs/logger/logger";
import { GoogleImplicitAuthorization } from "./GoogleImplicitAuthorization";

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
  beforeEach(() => {
    vi.stubGlobal("location", { origin: ORIGIN });
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("opens one implicit OAuth request and returns account-bound credentials", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    const open = vi.fn<typeof window.open>(() => popup.window);
    const fetch = vi.fn(async () => Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }));
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");

    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authorizeUrl.searchParams.get("response_type")).toBe("id_token token");
    expect(authorizeUrl.searchParams.get("scope")).toContain(APP_DATA_SCOPE);
    expect(authorizeUrl.searchParams.get("include_granted_scopes")).toBe("false");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(ORIGIN);
    const nonce = authorizeUrl.searchParams.get("nonce");
    const state = authorizeUrl.searchParams.get("state");
    expect(open.mock.calls[0]?.[1]).toBe(`pubky-passport-google-${state}`);
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
      googleAccount: { googleSubject: SUBJECT, email: "person@example.com", name: "Person", pictureUrl: null },
    }));
    expect(fetch).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", expect.objectContaining({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }));
    expect(popup.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(localStorage)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(sessionStorage)).not.toContain(ACCESS_TOKEN);
  });

  it("keeps a captured response after closing the popup", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    let resolveUserInfo!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise((resolve) => {
      resolveUserInfo = resolve;
    }));
    const open = vi.fn<typeof window.open>(() => popup.window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));

    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      scope: APP_DATA_SCOPE,
      state: authorizeUrl.searchParams.get("state") ?? "",
    })}`);
    expect(popup.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    resolveUserInfo(Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }));

    await expect(request).resolves.toEqual(Result.ok({
      googleIdToken: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      driveAccessToken: ACCESS_TOKEN,
      googleAccount: { googleSubject: SUBJECT, email: "person@example.com", name: "Person", pictureUrl: null },
    }));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("consumes only one response message", async () => {
    const popup = createPopup();
    const fetch = vi.fn(async () => Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }));
    const open = vi.fn<typeof window.open>(() => popup.window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
    const responseUrl = `${ORIGIN}/#${new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      scope: APP_DATA_SCOPE,
      state: authorizeUrl.searchParams.get("state") ?? "",
    })}`;

    popup.returnTo(responseUrl);
    popup.returnTo(responseUrl);
    await request;

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("localizes a supported Google avatar before returning credentials", async () => {
    const popup = createPopup();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => String(input) === "https://openidconnect.googleapis.com/v1/userinfo"
      ? Response.json({
        sub: SUBJECT,
        email: "person@example.com",
        name: "Person",
        picture: "https://lh3.googleusercontent.com/avatar",
      })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }));
    const open = vi.fn<typeof window.open>(() => popup.window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      scope: APP_DATA_SCOPE,
      state: authorizeUrl.searchParams.get("state") ?? "",
    })}`);

    const result = await request;
    expect(Result.isError(result)).toBe(false);
    if (Result.isError(result)) return;
    expect(result.value.googleAccount.pictureUrl).toBe("data:image/png;base64,AQID");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps avatar failures nonfatal and logs only safe metadata", async () => {
    const thrown = { secret: "AVATAR-FAILURE-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopup();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input) === "https://openidconnect.googleapis.com/v1/userinfo") {
        return Response.json({
          sub: SUBJECT,
          email: "person@example.com",
          name: "Person",
          picture: "https://lh3.googleusercontent.com/avatar",
        });
      }
      throw thrown;
    });
    const open = vi.fn<typeof window.open>(() => popup.window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      scope: APP_DATA_SCOPE,
      state: authorizeUrl.searchParams.get("state") ?? "",
    })}`);

    const result = await request;

    expect(Result.isError(result)).toBe(false);
    if (!Result.isError(result)) expect(result.value.googleAccount.pictureUrl).toBeNull();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("AVATAR-FAILURE-CANARY");
  });

  it("preserves user-info exceptions as exact causes without logging details", async () => {
    const thrown = { secret: "USERINFO-FAILURE-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopup();
    const open = vi.fn<typeof window.open>(() => popup.window);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockRejectedValue(thrown));
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();
    const authorizeUrl = new URL(String(open.mock.calls[0]?.[0]));
    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      scope: APP_DATA_SCOPE,
      state: authorizeUrl.searchParams.get("state") ?? "",
    })}`);

    const result = await request;

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("google_authorization_failed");
      expect(result.error.cause).toBe(thrown);
    }
    expect(JSON.stringify(warning.mock.calls)).not.toContain("USERINFO-FAILURE-CANARY");
  });

  it("reports popup closure from the popup handle", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    vi.stubGlobal("open", vi.fn<typeof window.open>(() => popup.window));
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(200);

    const result = await request;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.code).toBe("google_authorization_popup_closed");
  });

  it.each([
    ["access_denied", "google_authorization_denied"],
    ["server_error", "google_authorization_failed"],
  ] as const)("maps the Google %s response precisely", async (googleError, expectedCode) => {
    const popup = createPopup();
    const open = vi.fn<typeof window.open>(() => popup.window);
    vi.stubGlobal("open", open);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();
    const state = new URL(String(open.mock.calls[0]?.[0])).searchParams.get("state") ?? "";

    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({ error: googleError, state })}`);

    const result = await request;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: expectedCode });
  });

  it.each([
    ["missing", undefined],
    ["wrong", "wrong"],
    ["duplicate", "duplicate"],
  ] as const)("rejects an error response with %s state", async (stateCase, suppliedState) => {
    const popup = createPopup();
    const open = vi.fn<typeof window.open>(() => popup.window);
    vi.stubGlobal("open", open);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();
    const expectedState = new URL(String(open.mock.calls[0]?.[0])).searchParams.get("state") ?? "";
    const state = stateCase === "duplicate" ? expectedState : suppliedState;
    const params = new URLSearchParams({ error: "access_denied", ...(state ? { state } : {}) });
    if (stateCase === "duplicate") params.append("state", "duplicate");

    popup.returnTo(`${ORIGIN}/#${params}`);

    const result = await request;
    expect(Result.isError(result) && result.error).toEqual({ code: "google_authorization_failed" });
  });

  it("rejects concurrent requests and times out the active request", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    vi.stubGlobal("open", vi.fn<typeof window.open>(() => popup.window));
    const authorization = new GoogleImplicitAuthorization("client-id");
    const active = authorization.request();

    const concurrent = await authorization.request();
    expect(Result.isError(concurrent) && concurrent.error).toEqual({ code: "google_authorization_failed" });
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    const timedOut = await active;
    expect(Result.isError(timedOut) && timedOut.error).toEqual({ code: "google_authorization_failed" });
    expect(popup.close).toHaveBeenCalledOnce();
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
      vi.stubGlobal("open", open);
      vi.stubGlobal("fetch", fetch);
      const authorization = new GoogleImplicitAuthorization("client-id");
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
      `&id_token=duplicate`,
      `&access_token=duplicate`,
      `&scope=${encodeURIComponent(APP_DATA_SCOPE)}`,
      `&scope=${encodeURIComponent("https://www.googleapis.com/auth/drive")}`,
    ]) {
      const popup = createPopup();
      const open = vi.fn<typeof window.open>(() => popup.window);
      vi.stubGlobal("open", open);
      const authorization = new GoogleImplicitAuthorization("client-id");
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

  it("disposal aborts in-flight account verification", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    const open = vi.fn<typeof window.open>(() => popup.window);
    let fetchSignal: AbortSignal | null = null;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      fetchSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
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
    vi.stubGlobal("open", vi.fn<typeof window.open>(() => null));
    const authorization = new GoogleImplicitAuthorization("client-id");
    const result = await authorization.request();
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.code).toBe("google_authorization_popup_failed_to_open");
  });

  it("preserves authorization setup exceptions as exact causes", async () => {
    const thrown = { secret: "AUTHORIZATION-SETUP-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementationOnce(() => {
      throw thrown;
    });

    const result = await new GoogleImplicitAuthorization("client-id").request();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("google_authorization_failed");
      expect(result.error.cause).toBe(thrown);
    }
    expect(JSON.stringify(warning.mock.calls)).not.toContain("AUTHORIZATION-SETUP-CANARY");
  });

  it("closes the popup when attempt registration fails", async () => {
    const popup = createPopup();
    const cause = new Error("SECRET-ATTEMPT-SETUP-CANARY");
    vi.stubGlobal("open", vi.fn<typeof window.open>(() => popup.window));
    vi.spyOn(globalThis.window, "addEventListener").mockImplementationOnce(() => {
      throw cause;
    });

    const result = await new GoogleImplicitAuthorization("client-id").request();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.cause).toBe(cause);
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("settles the request when attempt cleanup fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopup();
    vi.stubGlobal("open", vi.fn<typeof window.open>(() => popup.window));
    vi.spyOn(globalThis.window, "removeEventListener").mockImplementationOnce(() => {
      throw new Error("SECRET-CLEANUP-CANARY");
    });
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request();

    authorization.dispose();

    const result = await request;

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.code).toBe("google_authorization_failed");
    expect(popup.close).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "identity.google.implicit_authorization.cleanup_failed",
      { operation: "remove_message_listener" },
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-CLEANUP-CANARY");
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
