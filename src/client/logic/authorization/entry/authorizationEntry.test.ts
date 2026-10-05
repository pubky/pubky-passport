/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { EARLY_AUTHORIZATION_LOCATION_PROPERTY } from "@/libs/authorization/earlyAuthorizationLocation";
import { LOGGER } from "@/libs/logger/logger";
import { PUBKY_AUTH_REQUEST_LIMITS } from "@/client/logic/authorization/request/parser/pubkyAuthRequestParser";
import {
  forwardHomeAuthorizationRequest,
  invalidateAuthorizationEntry,
  leaveEmptyAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
} from "./authorizationEntry";

const RELAY_ORIGIN = "https://relay.example";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("authorizationEntry", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.resolve();
    window.history.replaceState({}, "", "/");
    Reflect.deleteProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY);
  });

  it("consumes a parser-time capture after the URL is already scrubbed", () => {
    const hash = `#d=${encodeURIComponent(validRequest())}`;
    window.history.replaceState({}, "", "/authorize");
    Object.defineProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY, {
      configurable: true,
      value: vi.fn(() => ({
        status: "captured",
        hash,
        expiresAt: Date.now() + 60_000,
      })),
    });

    expect(readAndScrubAuthorizationEntry(window).status).toBe("valid");
    expect(window.location.hash).toBe("");
  });

  it("consumes an expired capture once", () => {
    window.history.replaceState({}, "", "/authorize");
    Object.defineProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY, {
      configurable: true,
      value: vi.fn(() => {
        Reflect.deleteProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY);
        return { status: "expired" };
      }),
    });

    const first = readAndScrubAuthorizationEntry(window);
    const second = readAndScrubAuthorizationEntry(window);

    expect(first).toEqual({ status: "expired" });
    expect(second).toEqual({ status: "empty" });
  });

  it("scrubs synchronously and consumes the fragment once", () => {
    setAuthorizationUrl(validRequest());

    const first = readAndScrubAuthorizationEntry(window);
    const second = readAndScrubAuthorizationEntry(window);

    expect(window.location.pathname).toBe("/authorize");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(first.status).toBe("valid");
    expect(second).toEqual({ status: "empty" });
  });

  it("bypasses framework-patched history methods while scrubbing", () => {
    setAuthorizationUrl(validRequest());
    const frameworkReplaceState = vi.fn();
    Object.defineProperty(window.history, "replaceState", {
      configurable: true,
      value: frameworkReplaceState,
    });

    try {
      const entry = readAndScrubAuthorizationEntry(window);
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");
      expect(frameworkReplaceState).not.toHaveBeenCalled();
      expect(entry.status).toBe("valid");
    } finally {
      Reflect.deleteProperty(window.history, "replaceState");
    }
  });

  it("invalidates approval provenance when an entry is abandoned", () => {
    setAuthorizationUrl(validRequest());
    const entry = readAndScrubAuthorizationEntry(window);
    if (entry.status !== "valid") throw new Error("Expected a valid authorization entry");

    expect(invalidateAuthorizationEntry(entry)).toEqual({
      status: "invalid",
      code: "history_unavailable",
    });

    expect(entry.request.isLive()).toBe(false);
  });

  it.each([
    [(): string => `d=${encodeURIComponent(validRequest())}&profile=required`, "required"],
    [(): string => `profile=required&d=${encodeURIComponent(validRequest())}`, "required"],
    [(): string => `d=${encodeURIComponent(validRequest())}&profile=optional`, undefined],
    [(): string => `d=${encodeURIComponent(validRequest())}`, undefined],
  ] as const)("reads the app's profile requirement next to d= (%#)", (fragment, profile) => {
    setRawAuthorizationFragment(fragment());
    const entry = readAndScrubAuthorizationEntry(window);
    if (entry.status !== "valid") throw new Error("Expected a valid authorization entry");
    expect(entry.profile).toBe(profile);
    expect(window.location.hash).toBe("");
    entry.request.release();
  });

  it("distinguishes an empty manual entry from a malformed request", () => {
    window.history.replaceState({}, "", "/authorize");
    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "empty" });

    setRawAuthorizationFragment("unexpected=value");
    expect(readAndScrubAuthorizationEntry(window)).toEqual({
      status: "invalid",
      code: "invalid_fragment_shape",
    });
  });

  it.each([
    [(): string => `d=${validRequest()}`, "invalid_fragment_shape"],
    [
      () =>
        `d=${"%41".repeat(Math.ceil(PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits / 3) + 1)}`,
      "too_large",
    ],
    [
      (): string =>
        `d=${encodeURIComponent(validRequest())}&d=${encodeURIComponent(validRequest())}`,
      "invalid_fragment_shape",
    ],
    [(): string => "d=%E0%A4%A", "invalid_encoding"],
    [
      (): string => `d=${encodeURIComponent(validRequest())}&unexpected=value`,
      "invalid_fragment_shape",
    ],
    [
      (): string => `d=${encodeURIComponent(validRequest())}&profile=always`,
      "invalid_fragment_shape",
    ],
    [
      (): string => `d=${encodeURIComponent(validRequest())}&profile=required&profile=required`,
      "invalid_fragment_shape",
    ],
    [(): string => "profile=required", "invalid_fragment_shape"],
  ] as const)("rejects invalid raw d input without exposing it", (fragment, code) => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    setRawAuthorizationFragment(fragment());

    const entry = readAndScrubAuthorizationEntry(window);

    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(entry).toEqual({ status: "invalid", code });
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith("authorize.parse.failed", {
      source: "fragment",
      code: expect.any(String),
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(SECRET);
  });

  it("treats a plain query string as an empty entry and scrubs it", () => {
    window.history.replaceState({}, "", "/authorize?utm_source=newsletter&ref=home");

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "empty" });
    expect(window.location.search).toBe("");
  });

  it("rejects legacy query transport without a fragment", () => {
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);

    expect(readAndScrubAuthorizationEntry(window)).toEqual({
      status: "invalid",
      code: "invalid_search",
    });
    expect(window.location.search).toBe("");
  });

  it("rejects legacy query transport even when a valid fragment is present", () => {
    window.history.replaceState(
      {},
      "",
      `/authorize?d=${encodeURIComponent(validRequest())}#d=${encodeURIComponent(validRequest())}`,
    );

    expect(readAndScrubAuthorizationEntry(window)).toEqual({
      status: "invalid",
      code: "invalid_search",
    });
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("rejects a plain query next to a valid fragment", () => {
    window.history.replaceState(
      {},
      "",
      `/authorize?utm_source=newsletter#d=${encodeURIComponent(validRequest())}`,
    );

    expect(readAndScrubAuthorizationEntry(window)).toEqual({
      status: "invalid",
      code: "invalid_search",
    });
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("rejects an oversized fragment before detailed parsing", () => {
    setRawAuthorizationFragment(
      `unexpected=${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits + 1)}`,
    );

    expect(readAndScrubAuthorizationEntry(window)).toEqual({
      status: "invalid",
      code: "too_large",
    });
    expect(window.location.hash).toBe("");
  });

  it.each(["too_large", "invalid_search"] as const)(
    "preserves the early-capture rejection code %s",
    (status) => {
      Object.defineProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY, {
        configurable: true,
        value: () => ({ status }),
      });
      expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "invalid", code: status });
    },
  );

  it("preserves the parser rejection code without echoing the request", () => {
    setAuthorizationUrl(validRequest().replace("https%3A", "http%3A"));
    expect(readAndScrubAuthorizationEntry(window)).toEqual({
      status: "invalid",
      code: "invalid_relay",
    });
  });

  it("preserves safe framework history state during a repeated hydration scrub", () => {
    const frameworkState = { __NA: true, tree: ["", { children: ["authorize"] }] };
    window.history.replaceState(frameworkState, "", "/authorize#d=encoded-request");

    scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true });

    expect(window.history.state).toEqual(frameworkState);
    expect(window.location.hash).toBe("");
  });

  it("clears framework history state that contains authorization data", () => {
    const sensitiveUrl = "/authorize#d=encoded-request";
    window.history.replaceState({ url: sensitiveUrl }, "", sensitiveUrl);

    scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true });

    expect(window.history.state).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("stops loading and abandons the request when native scrubbing fails", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const stop = vi.fn();
    const replace = vi.fn();
    const appWindow = {
      History: {
        prototype: {
          replaceState() {
            throw new Error(`unavailable ${SECRET}`);
          },
        },
      },
      history: {},
      location: {
        hash: `#d=${encodeURIComponent(validRequest())}`,
        pathname: "/authorize",
        replace,
        search: "",
      },
      stop,
    } as unknown as Window;

    expect(readAndScrubAuthorizationEntry(appWindow)).toEqual({
      status: "invalid",
      code: "history_unavailable",
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/authorize");
    expect(warning).toHaveBeenCalledWith("authorize.entry.failed", {
      operation: "scrub_fragment",
      code: "history_unavailable",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SECRET);
  });

  it("contains early-capture failures without exposing their contents", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    window.history.replaceState({}, "", "/authorize");
    Object.defineProperty(window, EARLY_AUTHORIZATION_LOCATION_PROPERTY, {
      configurable: true,
      value: () => {
        throw new TypeError(`capture failed ${SECRET}`);
      },
    });

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "empty" });
    expect(warning).toHaveBeenCalledWith("authorize.entry.failed", {
      operation: "take_early_capture",
      code: "capture_unavailable",
      diagnosticId: expect.any(String),
      errorName: "TypeError",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SECRET);
  });

  describe("home-page fallback forwarding", () => {
    it.each([
      `#d=${encodeURIComponent(validRequest())}`,
      `#%64=${encodeURIComponent(validRequest())}`,
    ])("scrubs, stops loading, then forwards %s to the authorization entry", (hash) => {
      const { appWindow, calls } = homeWindow("", hash);

      expect(forwardHomeAuthorizationRequest(appWindow)).toBe(true);
      expect(calls).toEqual(["replaceState:/", "stop", `replace:/authorize${hash}`]);
    });

    it.each([
      [`?d=${encodeURIComponent(validRequest())}`, ""],
      ["?utm_source=newsletter", `#d=${encodeURIComponent(validRequest())}`],
    ])("forwards %s%s for rejection without copying the query", (search, hash) => {
      const { appWindow, calls } = homeWindow(search, hash);

      expect(forwardHomeAuthorizationRequest(appWindow)).toBe(true);
      expect(calls).toEqual(["replaceState:/", "stop", `replace:/authorize?d=${hash}`]);
      const forwardedQuery = calls.join().replace(hash, "");
      expect(forwardedQuery).not.toContain("newsletter");
      expect(forwardedQuery).not.toContain(SECRET);
    });

    it.each([
      ["", ""],
      ["?utm_source=newsletter", "#top"],
      ["", "#access_token=google-token&state=state"],
    ])("leaves %s%s on the home page", (search, hash) => {
      const { appWindow, calls } = homeWindow(search, hash);

      expect(forwardHomeAuthorizationRequest(appWindow)).toBe(false);
      expect(calls).toEqual([]);
    });

    it("keeps the request scrubbed when forwarding fails, without logging it", () => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { appWindow, calls } = homeWindow("", `#d=${encodeURIComponent(validRequest())}`, {
        replaceThrows: true,
      });

      expect(forwardHomeAuthorizationRequest(appWindow)).toBe(true);
      expect(calls.slice(0, 2)).toEqual(["replaceState:/", "stop"]);
      expect(appWindow.location.hash).toBe("");
      expect(warning).toHaveBeenCalledWith("authorize.entry.failed", {
        operation: "forward_request",
        code: "navigation_failed",
        diagnosticId: expect.any(String),
        errorName: "Error",
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain(SECRET);
    });
  });

  describe("leaving an entry without a request", () => {
    it("stops loading and replaces the entry with the home page", () => {
      const { appWindow, calls } = homeWindow("", "");

      leaveEmptyAuthorizationEntry(appWindow);

      expect(calls).toEqual(["stop", "replace:/"]);
    });

    it("logs a failed navigation", () => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { appWindow } = homeWindow("", "", { replaceThrows: true });

      leaveEmptyAuthorizationEntry(appWindow);

      expect(warning).toHaveBeenCalledWith("authorize.entry.failed", {
        operation: "leave_entry",
        code: "navigation_failed",
        diagnosticId: expect.any(String),
        errorName: "Error",
      });
    });
  });
});

function setAuthorizationUrl(request: string): void {
  window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(request)}`);
}

function setRawAuthorizationFragment(fragment: string): void {
  window.history.replaceState({}, "", `/authorize#${fragment}`);
}

/** A home-page window whose history and navigation calls are recorded in order. */
function homeWindow(search: string, hash: string, options: { replaceThrows?: boolean } = {}) {
  const calls: string[] = [];
  const location = {
    hash,
    pathname: "/",
    search,
    replace(url: string) {
      calls.push(`replace:${url}`);
      if (options.replaceThrows) throw new Error(`navigation failed ${SECRET}`);
    },
  };
  const appWindow = {
    History: {
      prototype: {
        replaceState(_state: unknown, _title: string, url: string) {
          calls.push(`replaceState:${url}`);
          location.search = "";
          location.hash = "";
        },
      },
    },
    history: {},
    location,
    stop: () => calls.push("stop"),
  } as unknown as Window;
  return { appWindow, calls };
}

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=${SECRET}`;
}
