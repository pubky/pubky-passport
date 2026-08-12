/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { PUBKY_AUTH_REQUEST_LIMITS } from "../../core/auth/pubkyAuthRequestLimits";
import { EARLY_AUTHORIZATION_LOCATION_PROPERTY } from "../../libs/authorization/earlyAuthorizationLocation";
import { LOGGER } from "../../libs/logger/logger";
import {
  clearPendingAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
} from "./browserAuthorizationEntry";

const RELAY_ORIGIN = "https://relay.example";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("browserAuthorizationEntry", () => {
  afterEach(async () => {
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
      value: vi.fn(() => ({ status: "captured", hash })),
    });

    expect(readAndScrubAuthorizationEntry(window).status).toBe("valid");
    expect(window.location.hash).toBe("");
  });

  it("scrubs synchronously and preserves a browser-issued request across a StrictMode double initializer", () => {
    setAuthorizationUrl(validRequest());

    const first = readAndScrubAuthorizationEntry(window);
    const second = readAndScrubAuthorizationEntry(window);

    expect(window.location.pathname).toBe("/authorize");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(first.status).toBe("valid");
    expect(second).toBe(first);
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

  it("does not reuse an abandoned entry after the pre-commit cache expires", async () => {
    setAuthorizationUrl(validRequest());
    readAndScrubAuthorizationEntry(window);

    await Promise.resolve();
    window.history.replaceState({}, "", "/authorize");

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "empty" });
  });

  it("clears the pre-commit cache explicitly", () => {
    setAuthorizationUrl(validRequest());
    readAndScrubAuthorizationEntry(window);
    clearPendingAuthorizationEntry(window);

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "empty" });
  });

  it("distinguishes an empty manual entry from a malformed request", () => {
    window.history.replaceState({}, "", "/authorize");
    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "empty" });

    setRawAuthorizationFragment("unexpected=value");
    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "invalid" });
  });

  it.each([
    () => `d=${validRequest()}`,
    () => `d=${"%41".repeat(Math.ceil(PUBKY_AUTH_REQUEST_LIMITS.encodedDLength / 3) + 1)}`,
    () => `d=${encodeURIComponent(validRequest())}&d=${encodeURIComponent(validRequest())}`,
    () => "d=%E0%A4%A",
    () => `d=${encodeURIComponent(validRequest())}&unexpected=value`,
  ])("rejects invalid raw d input without exposing it", (fragment) => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    setRawAuthorizationFragment(fragment());

    const entry = readAndScrubAuthorizationEntry(window);

    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(entry).toEqual({ status: "invalid" });
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith("authorize.parse.failed", {
      source: "fragment",
      code: expect.any(String),
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(SECRET);
  });

  it("rejects legacy query transport even when a valid fragment is present", () => {
    window.history.replaceState(
      {},
      "",
      `/authorize?d=${encodeURIComponent(validRequest())}#d=${encodeURIComponent(validRequest())}`,
    );

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "invalid" });
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("rejects an oversized fragment before detailed parsing", () => {
    setRawAuthorizationFragment(`unexpected=${"a".repeat(PUBKY_AUTH_REQUEST_LIMITS.encodedDLength + 1)}`);

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "invalid" });
    expect(window.location.hash).toBe("");
  });

  it("preserves safe framework history state during a repeated hydration scrub", () => {
    const frameworkState = { __NA: true, tree: ["", { children: ["authorize"] }] };
    window.history.replaceState(
      frameworkState,
      "",
      `/authorize#d=${encodeURIComponent(validRequest())}`,
    );

    scrubAuthorizationLocation(window, true);

    expect(window.history.state).toEqual(frameworkState);
    expect(window.location.hash).toBe("");
  });

  it("clears framework history state that contains authorization data", () => {
    const sensitiveUrl = `/authorize#d=${encodeURIComponent(validRequest())}`;
    window.history.replaceState({ url: sensitiveUrl }, "", sensitiveUrl);

    scrubAuthorizationLocation(window, true);

    expect(window.history.state).toBeNull();
    expect(window.location.hash).toBe("");
  });

});

function setAuthorizationUrl(request: string): void {
  window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(request)}`);
}

function setRawAuthorizationFragment(fragment: string): void {
  window.history.replaceState({}, "", `/authorize#${fragment}`);
}

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=${SECRET}`;
}
