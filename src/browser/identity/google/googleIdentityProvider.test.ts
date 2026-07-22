/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindGoogleCredentialCallback,
  googleDriveAppDataScope,
  loadGoogleAccounts,
  releaseGoogleCredentialCallback,
  requestGoogleDriveAccess,
  type GoogleAccounts,
} from "./googleIdentityProvider";

describe("Google credential callback ownership", () => {
  it("keeps one live owner and never dispatches to a rejected binding", () => {
    let dispatch: ((response: { credential?: unknown }) => void) | undefined;
    const accounts = googleAccounts();
    accounts.id.initialize = vi.fn((config) => { dispatch = config.callback; });
    const first = vi.fn();
    const second = vi.fn();

    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "google-client", callback: first }))).toBe(false);
    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "google-client", callback: second }))).toBe(true);
    dispatch?.({ credential: "first-credential" });
    expect(first).toHaveBeenCalledWith({ credential: "first-credential" });
    expect(second).not.toHaveBeenCalled();

    releaseGoogleCredentialCallback(second);
    dispatch?.({ credential: "still-first" });
    expect(first).toHaveBeenCalledWith({ credential: "still-first" });

    releaseGoogleCredentialCallback(first);
    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "google-client", callback: second }))).toBe(false);
    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "different-client", callback: first }))).toBe(true);
    dispatch?.({ credential: "second-credential" });
    expect(second).toHaveBeenCalledWith({ credential: "second-credential" });
    expect(first).not.toHaveBeenCalledWith({ credential: "second-credential" });

    releaseGoogleCredentialCallback(second);
  });
});

describe("requestGoogleDriveAccess", () => {
  afterEach(() => {
    delete window.google;
    document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((script) => script.remove());
    vi.useRealTimers();
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
    window.google = { accounts };
    const resultPromise = requestGoogleDriveAccess({ clientId: "google-client", loginHint: "google-subject" });

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
    window.google = { accounts };

    const resultPromise = requestGoogleDriveAccess({
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

  it.each([
    ["network failure", async () => { throw new TypeError("network unavailable"); }],
    ["non-2xx response", async () => Response.json({}, { status: 503 })],
    ["malformed body", async () => new Response("not-json")],
    ["missing subject", async () => Response.json({})],
    ["invalid subject", async () => Response.json({ sub: 42 })],
  ])("maps %s during Drive account verification to a safe unavailable error", async (_case, userInfoResponse) => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    window.google = { accounts: googleAccounts({ captureCallback(value) { callback = value; } }) };
    const fetchImpl = vi.fn(userInfoResponse) as unknown as typeof fetch;

    const resultPromise = requestGoogleDriveAccess({
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
    window.google = { accounts: googleAccounts({ captureErrorCallback(callback) { errorCallback = callback; } }) };

    const resultPromise = requestGoogleDriveAccess({ clientId: "google-client" });
    await vi.waitFor(() => expect(errorCallback).toBeDefined());
    errorCallback?.({ type });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code });
  });

  it("times out an interactive Drive request", async () => {
    vi.useFakeTimers();
    window.google = { accounts: googleAccounts() };

    const resultPromise = requestGoogleDriveAccess({ clientId: "google-client", timeoutMs: 25 });
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
    window.google = { accounts: googleAccounts({ captureCallback(value) { callback = value; } }) };
    const controller = new AbortController();

    const resultPromise = requestGoogleDriveAccess({
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
    window.google = { accounts: googleAccounts({ captureCallback(value) { callback = value; } }) };
    const controller = new AbortController();

    const resultPromise = requestGoogleDriveAccess({
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
    window.google = { accounts };

    const result = await requestGoogleDriveAccess({ clientId: "google-client" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_popup_failed_to_open" });
  });
});

describe("loadGoogleAccounts", () => {
  afterEach(() => {
    delete window.google;
    document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((script) => script.remove());
    vi.useRealTimers();
  });

  it("shares one pending script load and cleans up its listeners", async () => {
    const first = loadGoogleAccounts(document, 100);
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    expect(script).toBeInstanceOf(HTMLScriptElement);
    const removeEventListener = vi.spyOn(script as HTMLScriptElement, "removeEventListener");
    const second = loadGoogleAccounts(document, 100);
    window.google = { accounts: googleAccounts() };
    script?.dispatchEvent(new Event("load"));

    expect(Result.isError(await first)).toBe(false);
    expect(Result.isError(await second)).toBe(false);
    expect(document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')).toHaveLength(1);
    expect(removeEventListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("observes an already-present loading script", async () => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    document.head.append(script);

    const resultPromise = loadGoogleAccounts(document, 100);
    window.google = { accounts: googleAccounts() };
    script.dispatchEvent(new Event("load"));

    expect(Result.isError(await resultPromise)).toBe(false);
    expect(document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')).toHaveLength(1);
  });

  it("bounds a failed load and permits a retry", async () => {
    vi.useFakeTimers();
    const failedPromise = loadGoogleAccounts(document, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(Result.isError(await failedPromise)).toBe(true);
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull();

    const retried = loadGoogleAccounts(document, 20);
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    window.google = { accounts: googleAccounts() };
    script?.dispatchEvent(new Event("load"));
    expect(Result.isError(await retried)).toBe(false);
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
