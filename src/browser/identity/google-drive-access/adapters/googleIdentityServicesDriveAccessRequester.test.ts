/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  googleDriveAppDataScope,
  requestGoogleDriveAccessToken as requestGoogleDriveAccessTokenWithLoader,
} from "./googleIdentityServicesDriveAccessRequester";
import type { GoogleAccounts } from "../../google-identity-services/application/googleIdentityServices";

let loadedGoogleAccounts: GoogleAccounts | undefined;

describe("requestGoogleDriveAccessToken", () => {
  afterEach(() => {
    loadedGoogleAccounts = undefined;
    vi.useRealTimers();
  });

  it("maps a throwing GIS loader to google_unavailable", async () => {
    const result = await requestGoogleDriveAccessTokenWithLoader({
      clientId: "google-client",
      googleIdentityServices: {
        loadGoogleAccounts: async () => { throw new Error("GIS unavailable"); },
      },
    });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_unavailable" });
  });

  it("rejects an OAuth response that lacks the Drive app data scope", async () => {
    let accessTokenCallback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    let tokenClientConfig: { client_id: string; scope: string; login_hint?: string } | undefined;
    const requestAccessToken = vi.fn();
    const accounts: GoogleAccounts = {
      id: {
        initialize: vi.fn(),
        renderButton: vi.fn(),
      },
      oauth2: {
        initTokenClient(config) {
          accessTokenCallback = config.callback;
          tokenClientConfig = config;
          return { requestAccessToken };
        },
      },
    };
    loadedGoogleAccounts = accounts;
    const resultPromise = requestGoogleDriveAccessToken({ clientId: "google-client", loginHint: "google-subject" });

    await vi.waitFor(() => expect(accessTokenCallback).toBeDefined());
    expect(tokenClientConfig).toMatchObject({
      login_hint: "google-subject",
      scope: `openid ${googleDriveAppDataScope}`,
    });
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "" });

    accessTokenCallback?.({ access_token: "drive-token", scope: "openid" });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_consent_failed" });
  });

  it("rejects a Drive token issued for a different Google subject", async () => {
    let accessTokenCallback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const accounts: GoogleAccounts = {
      id: {
        initialize: vi.fn(),
        renderButton: vi.fn(),
      },
      oauth2: {
        initTokenClient(config) {
          accessTokenCallback = config.callback;
          return { requestAccessToken: vi.fn() };
        },
      },
    };
    loadedGoogleAccounts = accounts;

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: (async () => Response.json({ sub: "different-subject" })) as typeof fetch,
    });

    await vi.waitFor(() => expect(accessTokenCallback).toBeDefined());
    accessTokenCallback?.({ access_token: "drive-token", scope: googleDriveAppDataScope });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_account_mismatch" });
  });

  it("hardens the Google user-info request and accepts a matching subject", async () => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const fetchImpl = vi.fn(async () => Response.json({ sub: "google-subject", name: "User" })) as unknown as typeof fetch;
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchImpl,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: "drive-token", scope: googleDriveAppDataScope });

    const result = await resultPromise;
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) expect(result.value).toBe("drive-token");
    expect(fetchImpl).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Accept: "application/json", Authorization: "Bearer drive-token" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ["network failure", async () => { throw new TypeError("network unavailable"); }],
    ["non-2xx response", async () => Response.json({}, { status: 503 })],
    ["malformed body", async () => new Response("not-json")],
    ["oversized body", async () => new Response("{}", { headers: { "Content-Length": String(16 * 1024 + 1) } })],
    ["missing subject", async () => Response.json({})],
    ["invalid subject", async () => Response.json({ sub: 42 })],
    ["blank subject", async () => Response.json({ sub: " " })],
    ["oversized subject", async () => Response.json({ sub: "s".repeat(256) })],
    ["array body", async () => Response.json([{ sub: "google-subject" }])],
  ])("maps %s during Drive account verification to a safe unavailable error", async (_case, userInfoResponse) => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });
    const fetchImpl = vi.fn(userInfoResponse) as unknown as typeof fetch;

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchImpl,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: "drive-token", scope: googleDriveAppDataScope });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_account_verification_failed" });
  });

  it.each([
    ["popup_closed", "drive_popup_closed"],
    ["popup_failed_to_open", "drive_popup_failed_to_open"],
    ["unexpected", "drive_popup_failed_to_open"],
  ])("maps the %s OAuth popup error", async (type, code) => {
    let errorCallback: ((error: { type?: unknown }) => void) | undefined;
    loadedGoogleAccounts = googleAccounts({ captureErrorCallback(callback) { errorCallback = callback; } });

    const resultPromise = requestGoogleDriveAccessToken({ clientId: "google-client" });
    await vi.waitFor(() => expect(errorCallback).toBeDefined());
    errorCallback?.({ type });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code });
  });

  it("times out an interactive Drive request", async () => {
    vi.useFakeTimers();
    loadedGoogleAccounts = googleAccounts();

    const resultPromise = requestGoogleDriveAccessToken({ clientId: "google-client", timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_consent_timeout" });
  });

  it("aborts once, ignores a late GIS callback, and passes the signal to user-info", async () => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ sub: "google-subject" });
    }) as unknown as typeof fetch;
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });
    const controller = new AbortController();

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchImpl,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    controller.abort();
    callback?.({ access_token: "late-token", scope: googleDriveAppDataScope });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_consent_aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps an abort during Drive account verification distinct from verification failure", async () => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });
    const controller = new AbortController();

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchImpl,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: "drive-token", scope: googleDriveAppDataScope });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_consent_aborted" });
  });

  it("maps synchronous GIS failures instead of rejecting", async () => {
    const accounts = googleAccounts();
    accounts.oauth2.initTokenClient = () => { throw new Error("GIS failed"); };
    loadedGoogleAccounts = accounts;

    const result = await requestGoogleDriveAccessToken({ clientId: "google-client" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_popup_failed_to_open" });
  });
});

function googleAccounts(input: {
  captureCallback?: (callback: (response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) => void;
  captureErrorCallback?: (callback: (error: { type?: unknown }) => void) => void;
} = {}): GoogleAccounts {
  return {
    id: { initialize: vi.fn(), renderButton: vi.fn() },
    oauth2: {
      initTokenClient(config) {
        input.captureCallback?.(config.callback);
        input.captureErrorCallback?.(config.error_callback);
        return { requestAccessToken: vi.fn() };
      },
    },
  };
}

function requestGoogleDriveAccessToken(
  input: Omit<Parameters<typeof requestGoogleDriveAccessTokenWithLoader>[0], "googleIdentityServices">,
) {
  return requestGoogleDriveAccessTokenWithLoader({
    ...input,
    googleIdentityServices: {
      loadGoogleAccounts: async () => loadedGoogleAccounts
        ? Result.ok(loadedGoogleAccounts)
        : Result.err({ code: "google_unavailable" }),
    },
  });
}
