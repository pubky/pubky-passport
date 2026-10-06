/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { EARLY_AUTHORIZATION_LOCATION_PROPERTY } from "./libs/authorization/earlyAuthorizationLocation";
import {
  EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY,
  GOOGLE_REDIRECT_STORAGE_KEY,
} from "./libs/authorization/googleRedirectConstants";
import { requestDigest } from "./libs/requestDigest";

const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("instrumentation-client authorization entry", () => {
  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
    vi.doUnmock("./client/logic/authorization/entry/authorizationEntry");
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
    Reflect.deleteProperty(window, EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY);
  });

  /** What a request leaves in the tab before it goes to Google in this window. */
  function saveGoogleRoundTrip(changes: Record<string, unknown> = {}): void {
    sessionStorage.setItem(
      GOOGLE_REDIRECT_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        operation: "establish",
        allowWithoutVisibleBackup: false,
        requestUrl: validRequest(),
        state: "s".repeat(43),
        // 32 bytes as canonical base64url: the last character leaves its spare bits empty.
        noncePreimage: "n".repeat(42) + "g",
        expiresAt: Date.now() + 60_000,
        ...changes,
      }),
    );
    // The parser-time script captured and scrubbed Google's answer before this module ran.
    Object.defineProperty(window, EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY, {
      configurable: true,
      value: () => ({
        type: "pubky-passport-google-implicit-response",
        status: "captured",
        hash: "#access_token=token-canary",
      }),
    });
  }

  it("resumes on / the request that left for Google, and answers its app's hello for it", async () => {
    const opener = { postMessage: vi.fn() };
    vi.stubGlobal("opener", opener);
    saveGoogleRoundTrip({ profileRequired: true });
    window.history.replaceState({}, "", "/");
    const bootstrap = await import("./instrumentation-client");
    // Read once: the saved request does not outlive the page that takes it.
    expect(sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY)).toBeNull();

    // The app's heartbeat keeps asking after its request; `empty` would report it lost.
    window.dispatchEvent(
      Object.assign(new Event("message"), {
        origin: "https://client.example",
        source: opener,
        data: {
          type: "pubky-passport.hello",
          version: 2,
          attemptId: "0123456789abcdef",
          features: [],
          request: requestDigest(validRequest()),
        },
      }),
    );
    expect(opener.postMessage.mock.calls[0]?.[0].request).toEqual({ status: "valid" });
    expect(opener.postMessage.mock.calls[0]?.[1]).toBe("https://client.example");

    // Next may restore the address bar Google returned to, tokens included: it is scrubbed again.
    window.history.replaceState({}, "", "/#access_token=token-canary");
    const entry = bootstrap.takeInitialAuthorizationEntry();
    expect(window.location.hash).toBe("");
    expect(entry).toMatchObject({ status: "valid", profile: "required" });
    if (entry?.status === "valid") {
      expect(entry.request.validatedUrlForApproval()).toBe(validRequest());
      entry.request.release();
    }
    // The profile link is a different way onto `/` and is not read here.
    expect(bootstrap.takeInitialProfileEntry()).toBeUndefined();
  });

  it("reports an expired round trip on / instead of resuming it", async () => {
    saveGoogleRoundTrip({ expiresAt: Date.now() - 1 });
    window.history.replaceState({}, "", "/");
    const bootstrap = await import("./instrumentation-client");

    expect(bootstrap.takeInitialAuthorizationEntry()).toEqual({ status: "expired" });
    expect(sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("drops a Google round trip left behind in the tab when a request enters at /authorize", async () => {
    saveGoogleRoundTrip();
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const bootstrap = await import("./instrumentation-client");

    expect(sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY)).toBeNull();
    const entry = bootstrap.takeInitialAuthorizationEntry();
    expect(entry?.status).toBe("valid");
    if (entry?.status === "valid") entry.request.release();
    const { isGoogleRedirectReturn } =
      await import("./client/logic/google-identity/gia/googleRedirectBootstrap");
    expect(isGoogleRedirectReturn()).toBe(false);
  });

  it.each([
    ["/", "empty"],
    ["/authorize#d=not-a-request", "invalid"],
    [`/authorize#d=${encodeURIComponent(validRequest())}`, "valid"],
  ])("installs the document channel before hydration at %s", async (url, status) => {
    const opener = { postMessage: vi.fn() };
    vi.stubGlobal("opener", opener);
    window.history.replaceState({}, "", url);
    await import("./instrumentation-client");
    window.dispatchEvent(
      Object.assign(new Event("message"), {
        origin: "https://client.example",
        source: opener,
        data: {
          type: "pubky-passport.hello",
          version: 2,
          attemptId: "0123456789abcdef",
          features: [],
          // A40: a request document binds only to the digest of the request it holds.
          ...(status === "valid" ? { request: requestDigest(validRequest()) } : {}),
        },
      }),
    );
    expect(opener.postMessage.mock.calls[0]?.[0].request).toEqual(
      status === "invalid" ? { status, code: expect.any(String) } : { status },
    );
    const { takeOpenerChannel } = await import("./client/logic/authorization/opener/OpenerChannel");
    // M1: only a request this opener started can name it; never `/` or an unusable link.
    expect(takeOpenerChannel()?.verifiedOpener()?.verifiedOrigin).toBe(
      status === "valid" ? "https://client.example" : undefined,
    );
  });

  it("does not install a home listener while forwarding a request", async () => {
    vi.stubGlobal("opener", { postMessage: vi.fn() });
    vi.doMock("./client/logic/authorization/entry/authorizationEntry", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      forwardHomeAuthorizationRequest: () => true,
    }));
    window.history.replaceState({}, "", "/#d=request");
    await import("./instrumentation-client");
    const { takeOpenerChannel } = await import("./client/logic/authorization/opener/OpenerChannel");
    expect(takeOpenerChannel()).toBeUndefined();
  });

  it("forwards a request from the home page instead of reading it there", async () => {
    const forward = vi.fn(() => true);
    vi.doMock("./client/logic/authorization/entry/authorizationEntry", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      forwardHomeAuthorizationRequest: forward,
    }));
    window.history.replaceState({}, "", `/#d=${encodeURIComponent(validRequest())}`);
    const bootstrap = await import("./instrumentation-client");

    expect(forward).toHaveBeenCalledExactlyOnceWith(window);
    expect(bootstrap.takeInitialAuthorizationEntry()).toBeUndefined();
  });

  it.each([
    ["no request", "/authorize", "empty"],
    ["a plain query", "/authorize?utm_source=newsletter", "empty"],
    ["an invalid request", "/authorize#d=not-a-request", "invalid"],
  ])("leaves an entry with %s for the home page only when it is empty", async (_, url, status) => {
    vi.stubGlobal("opener", { postMessage: vi.fn() });
    const leave = vi.fn();
    vi.doMock("./client/logic/authorization/entry/authorizationEntry", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      leaveEmptyAuthorizationEntry: leave,
    }));
    window.history.replaceState({}, "", url);
    const bootstrap = await import("./instrumentation-client");

    expect(leave.mock.calls).toEqual(status === "empty" ? [[window]] : []);
    expect(bootstrap.takeInitialAuthorizationEntry()?.status).toBe(status);
    const { takeOpenerChannel } = await import("./client/logic/authorization/opener/OpenerChannel");
    if (status === "empty") expect(takeOpenerChannel()).toBeUndefined();
    else expect(takeOpenerChannel()).toBeDefined();
  });

  it("neither reads nor forwards requests on other routes", async () => {
    vi.stubGlobal("opener", { postMessage: vi.fn() });
    const forward = vi.fn(() => true);
    vi.doMock("./client/logic/authorization/entry/authorizationEntry", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      forwardHomeAuthorizationRequest: forward,
    }));
    const url = `/privacy-policy#d=${encodeURIComponent(validRequest())}`;
    window.history.replaceState({}, "", url);
    const bootstrap = await import("./instrumentation-client");

    expect(forward).not.toHaveBeenCalled();
    expect(bootstrap.takeInitialAuthorizationEntry()).toBeUndefined();
    expect(window.location.pathname + window.location.hash).toBe(url);
    const { takeOpenerChannel } = await import("./client/logic/authorization/opener/OpenerChannel");
    expect(takeOpenerChannel()).toBeUndefined();
  });

  it("retains a parsed request without a review deadline", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const bootstrap = await import("./instrumentation-client");

    vi.advanceTimersByTime(24 * 60 * 60_000);

    const entry = bootstrap.takeInitialAuthorizationEntry();
    expect(entry?.status).toBe("valid");
    if (entry?.status === "valid") entry.request.release();
    expect(window.location.hash).toBe("");
  });

  it("does not reuse the early capture deadline as a review deadline", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/authorize");
    const hash = `#d=${encodeURIComponent(validRequest())}`;
    Object.defineProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY, {
      configurable: true,
      value: () => {
        Reflect.deleteProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY);
        return { status: "captured", hash, expiresAt: Date.now() + 1_000 };
      },
    });
    const bootstrap = await import("./instrumentation-client");

    vi.advanceTimersByTime(24 * 60 * 60_000);

    const entry = bootstrap.takeInitialAuthorizationEntry();
    expect(entry?.status).toBe("valid");
    if (entry?.status === "valid") entry.request.release();
  });

  it("re-scrubs if Next restores the secret-bearing address bar", async () => {
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const bootstrap = await import("./instrumentation-client");
    expect(window.location.hash).toBe("");

    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const entry = bootstrap.takeInitialAuthorizationEntry();

    expect(entry?.status).toBe("valid");
    if (entry?.status === "valid") entry.request.release();
    expect(window.location.hash).toBe("");
  });

  it("rejects an early capture whose short deadline already passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    window.history.replaceState({}, "", "/authorize");
    const hash = `#d=${encodeURIComponent(validRequest())}`;
    Object.defineProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY, {
      configurable: true,
      value: () => {
        Reflect.deleteProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY);
        return { status: "captured", hash, expiresAt: 1_000 };
      },
    });

    vi.setSystemTime(new Date(1_001));
    const bootstrap = await import("./instrumentation-client");

    expect(bootstrap.takeInitialAuthorizationEntry()).toEqual({ status: "expired" });
  });

  it("updates channel provenance when Next's restored fragment cannot be scrubbed", async () => {
    vi.stubGlobal("opener", { postMessage: vi.fn() });
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const bootstrap = await import("./instrumentation-client");
    const { takeOpenerChannel } = await import("./client/logic/authorization/opener/OpenerChannel");
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    vi.spyOn(History.prototype, "replaceState").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(bootstrap.takeInitialAuthorizationEntry()).toEqual({
      status: "invalid",
      code: "history_unavailable",
    });
    window.dispatchEvent(
      Object.assign(new Event("message"), {
        origin: "https://client.example",
        source: window.opener,
        data: {
          type: "pubky-passport.hello",
          version: 2,
          attemptId: "0123456789abcdef",
          features: [],
          request: requestDigest(validRequest()),
        },
      }),
    );
    expect(window.opener.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { status: "invalid", code: "history_unavailable" },
      }),
      "https://client.example",
    );
    expect(takeOpenerChannel()?.verifiedOpener()).toBeDefined();
  });
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`;
}
