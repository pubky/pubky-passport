/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_DRIVE_APP_DATA_SCOPE,
  requestGoogleDriveAccessToken as requestGoogleDriveAccessTokenWithLoader,
} from "./googleDriveAccessToken";
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
      scope: `openid ${GOOGLE_DRIVE_APP_DATA_SCOPE}`,
    });
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "" });

    accessTokenCallback?.({ access_token: "drive-token", scope: "openid" });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_failed" });
  });

  it("rejects a Drive token issued for a different Google subject", async () => {
    let accessTokenCallback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const fetchRecorder = new SanitizedFetchRecorder("different_subject");
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
      fetch: fetchRecorder.fetch,
    });

    await vi.waitFor(() => expect(accessTokenCallback).toBeDefined());
    accessTokenCallback?.({ access_token: "drive-token", scope: GOOGLE_DRIVE_APP_DATA_SCOPE });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_account_mismatch" });
  });

  it("hardens the Google user-info request and accepts a matching subject", async () => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const accessToken = "synthetic-drive-access-token-canary";
    const fetchRecorder = new SanitizedFetchRecorder("matching_subject");
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: accessToken, scope: GOOGLE_DRIVE_APP_DATA_SCOPE });

    const result = await resultPromise;
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) expect(result.value).toBe(accessToken);
    expect(fetchRecorder.calls).toEqual([{
      endpoint: "google_user_info",
      method: "GET",
      acceptsJson: true,
      hasBearerToken: true,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      hasSignal: true,
    }]);
    expect(JSON.stringify(fetchRecorder)).not.toContain(accessToken);
    expect(JSON.stringify(fetchRecorder)).not.toContain("Authorization");
  });

  it.each([
    ["network failure", "network_throw"],
    ["non-2xx response", "non_2xx"],
    ["malformed body", "malformed_body"],
    ["oversized body", "oversized_body"],
    ["missing subject", "missing_subject"],
    ["invalid subject", "invalid_subject"],
    ["blank subject", "blank_subject"],
    ["oversized subject", "oversized_subject"],
    ["array body", "array_body"],
  ] as const)("maps %s during Drive account verification to a safe unavailable error", async (_case, responseMode) => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });
    const fetchRecorder = new SanitizedFetchRecorder(responseMode);

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: "drive-token", scope: GOOGLE_DRIVE_APP_DATA_SCOPE });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_account_verification_failed" });
  });

  it.each([
    ["popup_closed", "google_drive_authorization_popup_closed"],
    ["popup_failed_to_open", "google_drive_authorization_popup_failed_to_open"],
    ["unexpected", "google_drive_authorization_popup_failed_to_open"],
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
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_timeout" });
  });

  it("aborts once, ignores a late GIS callback, and passes the signal to user-info", async () => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const fetchRecorder = new SanitizedFetchRecorder("matching_subject");
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });
    const controller = new AbortController();

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    controller.abort();
    callback?.({ access_token: "late-token", scope: GOOGLE_DRIVE_APP_DATA_SCOPE });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_aborted" });
    expect(fetchRecorder.calls).toEqual([]);
  });

  it("keeps an abort during Drive account verification distinct from verification failure", async () => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const fetchRecorder = new SanitizedFetchRecorder("pending_until_abort");
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });
    const controller = new AbortController();

    const resultPromise = requestGoogleDriveAccessToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: "drive-token", scope: GOOGLE_DRIVE_APP_DATA_SCOPE });
    await vi.waitFor(() => expect(fetchRecorder.calls).toHaveLength(1));
    controller.abort();

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_aborted" });
  });

  it("maps synchronous GIS failures instead of rejecting", async () => {
    const accounts = googleAccounts();
    accounts.oauth2.initTokenClient = () => { throw new Error("GIS failed"); };
    loadedGoogleAccounts = accounts;

    const result = await requestGoogleDriveAccessToken({ clientId: "google-client" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_popup_failed_to_open" });
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

type UserInfoResponseMode =
  | "matching_subject"
  | "different_subject"
  | "network_throw"
  | "non_2xx"
  | "malformed_body"
  | "oversized_body"
  | "missing_subject"
  | "invalid_subject"
  | "blank_subject"
  | "oversized_subject"
  | "array_body"
  | "pending_until_abort";

type SanitizedFetchCall = {
  endpoint: "google_user_info" | "unexpected";
  method: string;
  acceptsJson: boolean;
  hasBearerToken: boolean;
  cache: RequestCache | undefined;
  credentials: RequestCredentials | undefined;
  redirect: RequestRedirect | undefined;
  referrerPolicy: ReferrerPolicy | undefined;
  hasSignal: boolean;
};

class SanitizedFetchRecorder {
  readonly calls: SanitizedFetchCall[] = [];
  readonly #responseMode: UserInfoResponseMode;

  constructor(responseMode: UserInfoResponseMode) {
    this.#responseMode = responseMode;
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    this.calls.push({
      endpoint: url === "https://openidconnect.googleapis.com/v1/userinfo" ? "google_user_info" : "unexpected",
      method: init?.method ?? "GET",
      acceptsJson: headers.get("Accept") === "application/json",
      hasBearerToken: authorization?.startsWith("Bearer ") === true && authorization.length > "Bearer ".length,
      cache: init?.cache,
      credentials: init?.credentials,
      redirect: init?.redirect,
      referrerPolicy: init?.referrerPolicy,
      hasSignal: init?.signal instanceof AbortSignal,
    });

    switch (this.#responseMode) {
      case "matching_subject": return Response.json({ sub: "google-subject", name: "User" });
      case "different_subject": return Response.json({ sub: "different-subject" });
      case "network_throw": throw new TypeError("network unavailable");
      case "non_2xx": return Response.json({}, { status: 503 });
      case "malformed_body": return new Response("not-json");
      case "oversized_body": return new Response("{}", { headers: { "Content-Length": String(16 * 1024 + 1) } });
      case "missing_subject": return Response.json({});
      case "invalid_subject": return Response.json({ sub: 42 });
      case "blank_subject": return Response.json({ sub: " " });
      case "oversized_subject": return Response.json({ sub: "s".repeat(256) });
      case "array_body": return Response.json([{ sub: "google-subject" }]);
      case "pending_until_abort": return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }
  }) as typeof fetch;
}
