/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import {
  EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY,
  GOOGLE_REDIRECT_STORAGE_KEY,
} from "@/libs/authorization/googleRedirectConstants";
import { GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE } from "@/libs/authorization/earlyGoogleImplicitResponse";
import { AUTHORIZATION_TIMEOUT_MS } from "@/libs/passportPolicy";
import { GoogleRedirectAuthorization } from "./GoogleRedirectAuthorization";
import {
  resumeGoogleRedirect,
  setGoogleRedirectRequest,
  type GoogleRedirectAttempt,
} from "./googleRedirectBootstrap";

const REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https%3A%2F%2Fclient.example%2Fdone";
const OPERATION = { operation: "establish", allowWithoutVisibleBackup: false } as const;

describe("same-tab Google authorization", () => {
  beforeEach(() => {
    sessionStorage.clear();
    const request = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
    if (Result.isError(request)) throw new Error("Invalid fixture");
    setGoogleRedirectRequest({ status: "valid", request: request.value }, window);
  });
  afterEach(() => {
    sessionStorage.clear();
    Reflect.deleteProperty(window, EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function start() {
    const replace = vi.fn();
    const appWindow = {
      sessionStorage,
      location: { origin: "https://passport.example", replace },
    } as unknown as Window;
    const authorization = new GoogleRedirectAuthorization("client-id", appWindow);
    const result = authorization.request(OPERATION);
    const raw = sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY);
    if (!raw) throw new Error("Missing attempt");
    const attempt = JSON.parse(raw) as GoogleRedirectAttempt;
    return { authorization, result, replace, attempt };
  }

  function returnFromGoogle(attempt: GoogleRedirectAttempt, changes: Record<string, string> = {}) {
    const claims = btoa(JSON.stringify({ sub: "google-subject", nonce: attempt.nonce }));
    const hash = `#${new URLSearchParams({
      state: attempt.state,
      id_token: `header.${claims}.signature`,
      access_token: "access-token-canary",
      scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
      expires_in: "3600",
      ...changes,
    })}`;
    Object.defineProperty(window, EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY, {
      configurable: true,
      value: () => ({ type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE, status: "captured", hash }),
    });
    return resumeGoogleRedirect(window);
  }

  it("navigates the existing window and stores no Google tokens", async () => {
    const open = vi.spyOn(window, "open");
    const started = start();
    const url = new URL(started.replace.mock.calls[0]?.[0] as string);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://passport.example");
    expect(url.searchParams.get("state")).toBe(started.attempt.state);
    expect(url.href).not.toContain("pubkyauth");
    expect(started.attempt.requestUrl).toBe(REQUEST);
    expect(open).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    started.authorization.dispose();
    expect(Result.isError(await started.result)).toBe(true);
    expect(sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY)).not.toBeNull();
  });

  it("resumes the exact request, validates Google and consumes temporary storage", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ sub: "google-subject", email: "test@example.com", name: "Test" }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const started = start();
    const entry = returnFromGoogle(started.attempt);
    expect(entry?.status).toBe("valid");
    if (entry?.status === "valid") expect(entry.request.validatedUrlForApproval()).toBe(REQUEST);
    expect(sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY)).toBeNull();
    const resumed = new GoogleRedirectAuthorization("client-id");
    expect(resumed.takeContinuation()).toMatchObject(OPERATION);
    expect(resumed.takeContinuation()).toBeUndefined();
    const result = await resumed.request(OPERATION);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result))
      expect(result.value.googleAccount.googleSubject).toBe("google-subject");
    expect(JSON.stringify(sessionStorage)).not.toContain("access-token-canary");
    started.authorization.dispose();
    resumed.dispose();
  });

  it.each([
    [{ state: "wrong-state" }, "google_authorization_failed"],
    [
      {
        id_token: `header.${btoa(JSON.stringify({ sub: "google-subject", nonce: "wrong" }))}.signature`,
      },
      "google_authorization_failed",
    ],
    [{ error: "access_denied" }, "google_authorization_denied"],
  ])(
    "rejects invalid or cancelled responses before fetching credentials: %j",
    async (changes, code) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const started = start();
      returnFromGoogle(started.attempt, changes as Record<string, string>);
      const resumed = new GoogleRedirectAuthorization("client-id");
      const result = await resumed.request(OPERATION);
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) expect(result.error.code).toBe(code);
      expect(fetch).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
      started.authorization.dispose();
      resumed.dispose();
    },
  );

  it("rejects expired attempts and clears them", () => {
    vi.useFakeTimers();
    const started = start();
    vi.advanceTimersByTime(AUTHORIZATION_TIMEOUT_MS + 1);
    expect(returnFromGoogle(started.attempt)).toEqual({ status: "expired" });
    expect(sessionStorage.length).toBe(0);
    started.authorization.dispose();
  });

  it("does not navigate if session storage is blocked", async () => {
    const replace = vi.fn();
    const appWindow = {
      location: { origin: "https://passport.example", replace },
      get sessionStorage() {
        throw new Error("blocked");
      },
    } as unknown as Window;
    const authorization = new GoogleRedirectAuthorization("client-id", appWindow);
    expect(Result.isError(await authorization.request(OPERATION))).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it("fails a return without credentials instead of automatically redirecting again", async () => {
    const started = start();
    expect(resumeGoogleRedirect(window)?.status).toBe("valid");
    const resumed = new GoogleRedirectAuthorization("client-id");
    expect(Result.isError(await resumed.request(OPERATION))).toBe(true);
    expect(sessionStorage.length).toBe(0);
    started.authorization.dispose();
    resumed.dispose();
  });

  it("revalidates a stored Pubky request instead of trusting storage", () => {
    const started = start();
    sessionStorage.setItem(
      GOOGLE_REDIRECT_STORAGE_KEY,
      JSON.stringify({ ...started.attempt, requestUrl: "javascript:alert(1)" }),
    );
    expect(returnFromGoogle(started.attempt)).toEqual({ status: "invalid" });
    expect(sessionStorage.length).toBe(0);
    started.authorization.dispose();
  });
});
