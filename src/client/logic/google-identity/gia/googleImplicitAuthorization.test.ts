// @vitest-environment jsdom

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE } from "@/libs/authorization/earlyGoogleImplicitResponse";
import { LOGGER } from "@/libs/logger/logger";
import { AuthorizationPopup } from "./AuthorizationPopup";
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
    const fetch = vi.fn(async () =>
      Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }),
    );
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");

    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authorizeUrl.searchParams.get("response_type")).toBe("id_token token");
    expect(authorizeUrl.searchParams.get("scope")).toContain(APP_DATA_SCOPE);
    expect(authorizeUrl.searchParams.get("include_granted_scopes")).toBe("false");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(ORIGIN);
    const nonce = authorizeUrl.searchParams.get("nonce");
    const state = authorizeUrl.searchParams.get("state");
    expect(globalThis.open).toHaveBeenCalledExactlyOnceWith(
      "about:blank",
      expect.stringMatching(/^pubky-passport-google-/u),
      "popup,width=520,height=680",
    );
    expect(popup.replace).toHaveBeenCalledOnce();
    popup.returnTo(
      `${ORIGIN}/#${new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce }),
        scope: GOOGLE_RETURNED_SCOPES,
        state: state ?? "",
      })}`,
    );
    await vi.advanceTimersByTimeAsync(200);

    await expect(request).resolves.toEqual(
      Result.ok({
        visibleBackupPermissionGranted: true,
        googleIdToken: jwt({ sub: SUBJECT, nonce }),
        driveAccessToken: ACCESS_TOKEN,
        driveAccessTokenExpiresAt: null,
        googleAccount: {
          googleSubject: SUBJECT,
          email: "person@example.com",
          name: "Person",
          pictureUrl: null,
        },
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://openidconnect.googleapis.com/v1/userinfo",
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(popup.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(localStorage)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(sessionStorage)).not.toContain(ACCESS_TOKEN);
  });

  it("keeps a captured response after closing the popup", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    let resolveUserInfo!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          resolveUserInfo = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();

    popup.returnTo(
      `${ORIGIN}/#${new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
        scope: APP_DATA_SCOPE,
        state: authorizeUrl.searchParams.get("state") ?? "",
      })}`,
    );
    expect(popup.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    resolveUserInfo(Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }));

    await expect(request).resolves.toEqual(
      Result.ok({
        googleIdToken: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
        driveAccessToken: ACCESS_TOKEN,
        driveAccessTokenExpiresAt: null,
        googleAccount: {
          googleSubject: SUBJECT,
          email: "person@example.com",
          name: "Person",
          pictureUrl: null,
        },
        visibleBackupPermissionGranted: false,
      }),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { values: ["3600"], lifetime: 3_600_000 },
    { values: ["0"], lifetime: 0 },
    { values: [], lifetime: null },
    { values: [""], lifetime: null },
    { values: ["-1"], lifetime: null },
    { values: ["1.5"], lifetime: null },
    { values: ["Infinity"], lifetime: null },
    { values: ["99999999999999999"], lifetime: null },
    { values: ["3600", "7200"], lifetime: null },
  ])("records expiry conservatively for expires_in=$values", async ({ values, lifetime }) => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const popup = createPopup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }),
      ),
    );
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();
    const response = new URLSearchParams({
      access_token: ACCESS_TOKEN,
      id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
      scope: APP_DATA_SCOPE,
      state: authorizeUrl.searchParams.get("state") ?? "",
    });
    for (const value of values) response.append("expires_in", value);
    popup.returnTo(`${ORIGIN}/#${response}`);

    const result = await request;
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.driveAccessTokenExpiresAt).toBe(lifetime === null ? null : now + lifetime);
    expect(result.value.visibleBackupPermissionGranted).toBe(false);
  });

  it("consumes only one response message", async () => {
    const popup = createPopup();
    const fetch = vi.fn(async () =>
      Response.json({ sub: SUBJECT, email: "person@example.com", name: "Person" }),
    );
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();
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

  it("returns a validated Google avatar URL without downloading it", async () => {
    const popup = createPopup();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input) === "https://openidconnect.googleapis.com/v1/userinfo"
        ? Response.json({
            sub: SUBJECT,
            email: "person@example.com",
            name: "Person",
            picture: "https://lh3.googleusercontent.com/avatar",
          })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();
    popup.returnTo(
      `${ORIGIN}/#${new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
        scope: APP_DATA_SCOPE,
        state: authorizeUrl.searchParams.get("state") ?? "",
      })}`,
    );

    const result = await request;
    expect(Result.isError(result)).toBe(false);
    if (Result.isError(result)) return;
    expect(result.value.googleAccount.pictureUrl).toBe("https://lh3.googleusercontent.com/avatar");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("ignores unsupported avatar origins", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopup();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input) === "https://openidconnect.googleapis.com/v1/userinfo") {
        return Response.json({
          sub: SUBJECT,
          email: "person@example.com",
          name: "Person",
          picture: "https://attacker.example/avatar",
        });
      }
      throw new Error("Avatar download must not run");
    });
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();
    popup.returnTo(
      `${ORIGIN}/#${new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
        scope: APP_DATA_SCOPE,
        state: authorizeUrl.searchParams.get("state") ?? "",
      })}`,
    );

    const result = await request;

    expect(Result.isError(result)).toBe(false);
    if (!Result.isError(result)) expect(result.value.googleAccount.pictureUrl).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(warning).not.toHaveBeenCalled();
  });

  it("preserves user-info exceptions as exact causes without logging details", async () => {
    const thrown = { secret: "USERINFO-FAILURE-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopup();
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockRejectedValue(thrown));
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();
    popup.returnTo(
      `${ORIGIN}/#${new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
        scope: APP_DATA_SCOPE,
        state: authorizeUrl.searchParams.get("state") ?? "",
      })}`,
    );

    const result = await request;

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("google_authorization_failed");
      expect(result.error.cause).toBe(thrown);
    }
    expect(JSON.stringify(warning.mock.calls)).not.toContain("USERINFO-FAILURE-CANARY");
  });

  it.each([null, false, 0, ""] as const)(
    "preserves a falsey user-info exception (%j)",
    async (thrown) => {
      const popup = createPopup();
      vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockRejectedValue(thrown));
      const authorization = new GoogleImplicitAuthorization("client-id");
      const request = authorization.request(popup.handle);
      const authorizeUrl = popup.authorizeUrl();
      popup.returnTo(
        `${ORIGIN}/#${new URLSearchParams({
          access_token: ACCESS_TOKEN,
          id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
          scope: APP_DATA_SCOPE,
          state: authorizeUrl.searchParams.get("state") ?? "",
        })}`,
      );

      const result = await request;

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) return;
      expect(result.error).toHaveProperty("cause", thrown);
    },
  );

  it("reports popup closure from the popup handle", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);

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
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const state = popup.authorizeUrl().searchParams.get("state") ?? "";

    popup.returnTo(`${ORIGIN}/#${new URLSearchParams({ error: googleError, state })}`);

    const result = await request;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: expectedCode });
    }
  });

  it.each([
    ["missing", undefined],
    ["wrong", "wrong"],
    ["duplicate", "duplicate"],
  ] as const)("rejects an error response with %s state", async (stateCase, suppliedState) => {
    const popup = createPopup();
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const expectedState = popup.authorizeUrl().searchParams.get("state") ?? "";
    const state = stateCase === "duplicate" ? expectedState : suppliedState;
    const params = new URLSearchParams({ error: "access_denied", ...(state ? { state } : {}) });
    if (stateCase === "duplicate") params.append("state", "duplicate");

    popup.returnTo(`${ORIGIN}/#${params}`);

    const result = await request;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "google_authorization_failed" });
    }
  });

  it("rejects concurrent requests and times out the active request", async () => {
    vi.useFakeTimers();
    const popup = createPopup();
    const authorization = new GoogleImplicitAuthorization("client-id");
    const active = authorization.request(popup.handle);

    const concurrentPopup = createPopup();
    const concurrent = await authorization.request(concurrentPopup.handle);
    expect(Result.isError(concurrent)).toBe(true);
    if (Result.isError(concurrent)) {
      expect(concurrent.error).toEqual({
        code: "google_authorization_failed",
        reason: "authorization_in_progress",
      });
    }
    expect(concurrentPopup.close).toHaveBeenCalledOnce();
    expect(concurrentPopup.replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    const timedOut = await active;
    expect(Result.isError(timedOut)).toBe(true);
    if (Result.isError(timedOut)) {
      expect(timedOut.error).toEqual({
        code: "google_authorization_failed",
        reason: "authorization_timed_out",
      });
    }
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("rejects state, nonce, scope, and account mismatches", async () => {
    vi.useFakeTimers();
    for (const scenario of ["state", "nonce", "scope", "subject"] as const) {
      const popup = createPopup();
      const fetch = vi.fn(async () =>
        Response.json({
          sub: scenario === "subject" ? "different-subject" : SUBJECT,
          email: "person@example.com",
          name: "Person",
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const authorization = new GoogleImplicitAuthorization("client-id");
      const request = authorization.request(popup.handle);
      const authorizeUrl = popup.authorizeUrl();
      const nonce = authorizeUrl.searchParams.get("nonce");
      const state = authorizeUrl.searchParams.get("state");
      popup.returnTo(
        `${ORIGIN}/#${new URLSearchParams({
          access_token: ACCESS_TOKEN,
          id_token: jwt({ sub: SUBJECT, nonce: scenario === "nonce" ? "wrong" : nonce }),
          scope: scenario === "scope" ? "openid" : APP_DATA_SCOPE,
          state: scenario === "state" ? "wrong" : (state ?? ""),
        })}`,
      );
      await vi.advanceTimersByTimeAsync(200);
      const result = await request;
      expect(Result.isError(result)).toBe(true);
      if (scenario === "scope" && Result.isError(result)) {
        expect(result.error.code).toBe("google_drive_access_required");
        expect(fetch).not.toHaveBeenCalled();
      }
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
      const authorization = new GoogleImplicitAuthorization("client-id");
      const request = authorization.request(popup.handle);
      const authorizeUrl = popup.authorizeUrl();
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
    let fetchSignal: AbortSignal | null = null;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      fetchSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetch);
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);
    const authorizeUrl = popup.authorizeUrl();
    popup.returnTo(
      `${ORIGIN}/#${new URLSearchParams({
        access_token: ACCESS_TOKEN,
        id_token: jwt({ sub: SUBJECT, nonce: authorizeUrl.searchParams.get("nonce") }),
        scope: APP_DATA_SCOPE,
        state: authorizeUrl.searchParams.get("state") ?? "",
      })}`,
    );
    await vi.waitFor(() => expect(fetchSignal).not.toBeNull());

    authorization.dispose();

    const result = await request;
    expect(Result.isError(result)).toBe(true);
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("preserves authorization setup exceptions as exact causes and closes the popup", async () => {
    const thrown = { secret: "AUTHORIZATION-SETUP-CANARY" };
    const popup = createPopup();
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementationOnce(() => {
      throw thrown;
    });

    const result = await new GoogleImplicitAuthorization("client-id").request(popup.handle);

    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.replace).not.toHaveBeenCalled();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("google_authorization_failed");
      expect(result.error.cause).toBe(thrown);
    }
    expect(warning).toHaveBeenCalledWith("identity.google.implicit_authorization.failed", {
      operation: "authorize",
      stage: "request_setup",
      code: "google_authorization_failed",
      diagnosticId: expect.any(String),
      errorName: "ErrorLike",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("AUTHORIZATION-SETUP-CANARY");
  });

  it("closes the popup when attempt registration fails", async () => {
    const popup = createPopup();
    const cause = new Error("SECRET-ATTEMPT-SETUP-CANARY");
    vi.spyOn(globalThis.window, "addEventListener").mockImplementationOnce(() => {
      throw cause;
    });

    const result = await new GoogleImplicitAuthorization("client-id").request(popup.handle);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.cause).toBe(cause);
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("settles the request when attempt cleanup fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopup();
    vi.spyOn(globalThis.window, "removeEventListener").mockImplementationOnce(() => {
      throw new Error("SECRET-CLEANUP-CANARY");
    });
    const authorization = new GoogleImplicitAuthorization("client-id");
    const request = authorization.request(popup.handle);

    authorization.dispose();

    const result = await request;

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({
        code: "google_authorization_failed",
        reason: "authorization_disposed",
      });
    }
    expect(popup.close).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.implicit_authorization.cleanup_failed", {
      operation: "remove_message_listener",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-CLEANUP-CANARY");
  });
});

/**
 * A fake popup window behind a real {@link AuthorizationPopup}, opened the way the controller
 * opens it: blank first, navigated to Google by the request under test.
 */
function createPopup() {
  let closed = false;
  let href = "about:blank";
  const close = vi.fn(() => {
    closed = true;
  });
  const replace = vi.fn((next: string) => {
    href = next;
  });
  const popup = {
    get closed() {
      return closed;
    },
    set closed(value: boolean) {
      closed = value;
    },
    location: {
      get href() {
        return href;
      },
      replace,
    },
    close,
  } as unknown as Window;
  vi.stubGlobal(
    "open",
    vi.fn<typeof window.open>(() => popup),
  );
  const handle = AuthorizationPopup.openPending();
  if (!handle) throw new Error("The fake popup must open");
  return {
    handle,
    window: popup,
    close,
    replace,
    /** The Google authorization URL the request navigated the popup to. */
    authorizeUrl: () => new URL(String(replace.mock.calls[0]?.[0])),
    get closed() {
      return closed;
    },
    set closed(value: boolean) {
      closed = value;
    },
    returnTo(value: string) {
      const url = new URL(value);
      href = `${url.origin}/`;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE, status: "captured", hash: url.hash },
          origin: url.origin,
          source: popup,
        }),
      );
    },
  };
}

function jwt(payload: unknown): string {
  return `eyJhbGciOiJub25lIn0.${encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}.signature`;
}
