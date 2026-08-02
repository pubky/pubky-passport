/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../libs/logger/logger";
import {
  GoogleDriveAccess,
  GOOGLE_DRIVE_APP_DATA_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  type GoogleDriveAccessOptions,
  type GoogleDriveAccessRequest,
} from "./googleDriveAccess";
import {
  GoogleIdentityServices,
  type GoogleAccounts,
} from "../google-identity-services/googleIdentityServices";

let loadedGoogleAccounts: GoogleAccounts | undefined;

describe("GoogleDriveAccess", () => {
  afterEach(() => {
    loadedGoogleAccounts = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps a throwing GIS loader to google_unavailable", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const result = await requestDriveTokenWithLoader({
      clientId: "google-client",
      googleIdentityServices: createGoogleIdentityServices(async () => {
        throw new Error("SECRET-GOOGLE-SUBJECT");
      }),
    });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_unavailable" });
    expect(warn).toHaveBeenCalledWith("identity.google.drive_authorization.failed", {
      operation: "request_access_token",
      stage: "services_load",
      code: "google_unavailable",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-GOOGLE-SUBJECT");
  });

  it("requests openid and both Drive scopes but accepts optional drive.file being absent", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
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
    const resultPromise = requestDriveToken({
      clientId: "google-client",
      selectAccount: true,
      fetch: new SanitizedFetchRecorder("matching_subject").fetch,
    });

    await vi.waitFor(() => expect(accessTokenCallback).toBeDefined());
    expect(tokenClientConfig).toMatchObject({
      login_hint: "google-subject",
      scope: `openid ${GOOGLE_DRIVE_APP_DATA_SCOPE} ${GOOGLE_DRIVE_FILE_SCOPE}`,
    });
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "select_account" });

    accessTokenCallback?.({ access_token: "drive-token", scope: `openid ${GOOGLE_DRIVE_APP_DATA_SCOPE}` });

    const result = await resultPromise;
    expect(Result.isOk(result)).toBe(true);
    expect(info.mock.calls).toEqual([
      ["identity.google.drive_authorization.started", { operation: "request_access_token" }],
      ["identity.google.drive_authorization.completed", { operation: "request_access_token" }],
    ]);
    expect(JSON.stringify(info.mock.calls)).not.toContain("drive-token");
    expect(JSON.stringify(info.mock.calls)).not.toContain("google-subject");
    expect(JSON.stringify(info.mock.calls)).not.toContain(GOOGLE_DRIVE_APP_DATA_SCOPE);
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

    const resultPromise = requestDriveToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
    });

    await vi.waitFor(() => expect(accessTokenCallback).toBeDefined());
    accessTokenCallback?.({ access_token: "drive-token", scope: driveScopes() });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_drive_authorization_account_mismatch" });
  });

  it("hardens the Google user-info request and accepts a matching subject", async () => {
    let callback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const accessToken = "synthetic-drive-access-token-canary";
    const fetchRecorder = new SanitizedFetchRecorder("matching_subject", accessToken);
    loadedGoogleAccounts = googleAccounts({ captureCallback(value) { callback = value; } });

    const resultPromise = requestDriveToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: accessToken, scope: driveScopes() });

    const result = await resultPromise;
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) expect(result.value).toBe(accessToken);
    expect(fetchRecorder.calls).toEqual([{
      endpoint: "google_user_info",
      method: "GET",
      acceptsJson: true,
      hasBearerToken: true,
      hasExpectedAccessToken: true,
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

    const resultPromise = requestDriveToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: "drive-token", scope: driveScopes() });

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

    const resultPromise = requestDriveToken({ clientId: "google-client" });
    await vi.waitFor(() => expect(errorCallback).toBeDefined());
    errorCallback?.({ type });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code });
  });

  it("times out an interactive Drive request", async () => {
    vi.useFakeTimers();
    loadedGoogleAccounts = googleAccounts();

    const resultPromise = requestDriveToken({ clientId: "google-client", timeoutMs: 25 });
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

    const resultPromise = requestDriveToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    controller.abort();
    callback?.({ access_token: "late-token", scope: driveScopes() });

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

    const resultPromise = requestDriveToken({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: fetchRecorder.fetch,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback?.({ access_token: "drive-token", scope: driveScopes() });
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

    const result = await requestDriveToken({ clientId: "google-client" });

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

function requestDriveToken(
  input: Omit<GoogleDriveAccessOptions, "googleIdentityServices"> & GoogleDriveAccessTestRequest,
) {
  return requestDriveTokenWithLoader({
    ...input,
    googleIdentityServices: createGoogleIdentityServices(async () => loadedGoogleAccounts
        ? Result.ok(loadedGoogleAccounts)
        : Result.err({ code: "google_unavailable" })),
  });
}

function requestDriveTokenWithLoader(
  input: GoogleDriveAccessOptions & GoogleDriveAccessTestRequest,
) {
  const {
    googleIdentityServices,
    clientId,
    fetch,
    timeoutMs,
    ...request
  } = input;
  return new GoogleDriveAccess({
    googleIdentityServices,
    clientId,
    ...(fetch ? { fetch } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }).requestAccessToken({
    ...request,
    expectedSubject: input.expectedSubject ?? "google-subject",
  });
}

type GoogleDriveAccessTestRequest = Omit<GoogleDriveAccessRequest, "expectedSubject"> & {
  expectedSubject?: string;
};

function driveScopes(): string {
  return `${GOOGLE_DRIVE_APP_DATA_SCOPE} ${GOOGLE_DRIVE_FILE_SCOPE}`;
}

function createGoogleIdentityServices(
  loadGoogleAccounts: GoogleIdentityServices["loadGoogleAccounts"],
): GoogleIdentityServices {
  const googleIdentityServices = new GoogleIdentityServices();
  vi.spyOn(googleIdentityServices, "loadGoogleAccounts").mockImplementation(loadGoogleAccounts);
  return googleIdentityServices;
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
  hasExpectedAccessToken: boolean;
  cache: RequestCache | undefined;
  credentials: RequestCredentials | undefined;
  redirect: RequestRedirect | undefined;
  referrerPolicy: ReferrerPolicy | undefined;
  hasSignal: boolean;
};

class SanitizedFetchRecorder {
  readonly calls: SanitizedFetchCall[] = [];
  readonly #responseMode: UserInfoResponseMode;
  readonly #expectedAccessToken: string;

  constructor(responseMode: UserInfoResponseMode, expectedAccessToken = "drive-token") {
    this.#responseMode = responseMode;
    this.#expectedAccessToken = expectedAccessToken;
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
      hasExpectedAccessToken: authorization === `Bearer ${this.#expectedAccessToken}`,
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
