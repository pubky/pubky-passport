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
  isGoogleRedirectReturn,
  requireProfileAfterGoogleRedirect,
  resumeGoogleRedirect,
  returnToAuthorization,
  setGoogleRedirectRequest,
  type GoogleRedirectAttempt,
} from "./googleRedirectBootstrap";
import { guardPendingRequest } from "@/client/logic/authorization/flow/leaveGuard";

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
      performance,
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
    // The page answers no opener with it; the code is one the entry type already has.
    expect(returnFromGoogle(started.attempt)).toEqual({
      status: "invalid",
      code: "history_unavailable",
    });
    expect(sessionStorage.length).toBe(0);
    started.authorization.dispose();
  });

  it("leaves for Google without the pending request's leave confirmation", () => {
    const replace = vi.fn();
    let beforeUnload: ((event: Event) => void) | undefined;
    const appWindow = {
      sessionStorage,
      performance,
      opener: null,
      location: { origin: "https://passport.example", replace },
      addEventListener: (type: string, listener: (event: Event) => void) => {
        if (type === "beforeunload") beforeUnload = listener;
      },
      removeEventListener: vi.fn(),
      document: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    } as unknown as Window;
    const remove = guardPendingRequest(appWindow, () => true);
    const asksBeforeLeaving = () => {
      const event = new Event("beforeunload", { cancelable: true });
      beforeUnload?.(event);
      return event.defaultPrevented;
    };
    // A reload or a closed window would drop the request: the browser asks first.
    expect(asksBeforeLeaving()).toBe(true);

    const authorization = new GoogleRedirectAuthorization("client-id", appWindow);
    void authorization.request(OPERATION);
    expect(replace).toHaveBeenCalledOnce();
    // The request is saved for the return, so the navigation to Google is not asked about.
    expect(sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY)).not.toBeNull();
    expect(asksBeforeLeaving()).toBe(false);
    remove();
    authorization.dispose();
  });

  it("keeps the app's profile requirement across the round trip and returns to /authorize with it", () => {
    const request = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
    if (Result.isError(request)) throw new Error("Invalid fixture");
    // Next to `d=`, or learned later from the app's hello.
    setGoogleRedirectRequest({ status: "valid", request: request.value }, window);
    requireProfileAfterGoogleRedirect(request.value);
    const started = start();
    expect(started.attempt.profileRequired).toBe(true);

    const entry = returnFromGoogle(started.attempt);
    expect(entry).toMatchObject({ status: "valid", profile: "required" });
    expect(isGoogleRedirectReturn()).toBe(true);
    const replace = vi.fn();
    const callbackPage = { performance, location: { replace } } as unknown as Window;
    expect(returnToAuthorization(callbackPage)).toBe(true);
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      `/authorize#d=${encodeURIComponent(REQUEST)}&profile=required`,
    );
    started.authorization.dispose();
  });

  it("returns to /authorize without a profile parameter the app did not ask for", () => {
    const started = start();
    expect(started.attempt.profileRequired).toBeUndefined();
    expect(returnFromGoogle(started.attempt)).toEqual({
      status: "valid",
      request: expect.any(ValidatedPubkyAuthRequest),
    });
    const replace = vi.fn();
    expect(returnToAuthorization({ performance, location: { replace } } as unknown as Window)).toBe(
      true,
    );
    expect(replace).toHaveBeenCalledExactlyOnceWith(`/authorize#d=${encodeURIComponent(REQUEST)}`);
    started.authorization.dispose();
  });

  it("has nowhere to return to once the saved attempt is unusable, and ignores another request's requirement", () => {
    const other = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
    if (Result.isError(other)) throw new Error("Invalid fixture");
    // Not the request this page holds: nothing changes.
    requireProfileAfterGoogleRedirect(other.value);
    const started = start();
    expect(started.attempt.profileRequired).toBeUndefined();

    sessionStorage.setItem(GOOGLE_REDIRECT_STORAGE_KEY, "{not json");
    expect(resumeGoogleRedirect(window)?.status).toBe("invalid");
    const replace = vi.fn();
    expect(returnToAuthorization({ performance, location: { replace } } as unknown as Window)).toBe(
      false,
    );
    expect(replace).not.toHaveBeenCalled();
    started.authorization.dispose();
  });

  it("refuses a saved attempt whose profile flag is not the one value it may have", () => {
    const started = start();
    sessionStorage.setItem(
      GOOGLE_REDIRECT_STORAGE_KEY,
      JSON.stringify({ ...started.attempt, profileRequired: "yes" }),
    );
    expect(returnFromGoogle(started.attempt)?.status).toBe("invalid");
    started.authorization.dispose();
  });
});
