/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { PUBKY_AUTH_REQUEST_LIMITS } from "../../../core/auth/pubkyAuthRequestLimits";
import { LOGGER } from "../../../libs/logger/logger";
import {
  commitAuthorizationEntry,
  readAndScrubAuthorizationEntry,
} from "./browserAuthorizationEntry";

const RELAY_ORIGIN = "https://relay.example";
const SECRET = "sensitive-authorization-secret";

describe("browserAuthorizationEntry", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.resolve();
    window.history.replaceState({}, "", "/");
  });

  it("scrubs synchronously and preserves a parser-issued request across a StrictMode double initializer", () => {
    setAuthorizationUrl(validRequest());

    const first = readAndScrubAuthorizationEntry(window);
    const second = readAndScrubAuthorizationEntry(window);

    expect(window.location.pathname).toBe("/authorize");
    expect(window.location.search).toBe("");
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

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "invalid" });
  });

  it("clears the pre-commit cache explicitly", () => {
    setAuthorizationUrl(validRequest());
    readAndScrubAuthorizationEntry(window);
    commitAuthorizationEntry(window);

    expect(readAndScrubAuthorizationEntry(window)).toEqual({ status: "invalid" });
  });

  it.each([
    () => `d=${validRequest()}`,
    () => `d=${"%41".repeat(Math.ceil(PUBKY_AUTH_REQUEST_LIMITS.encodedDLength / 3) + 1)}`,
    () => `d=${encodeURIComponent(validRequest())}&d=${encodeURIComponent(validRequest())}`,
    () => "d=%E0%A4%A",
  ])("rejects invalid raw d input without exposing it", (query) => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    setRawAuthorizationQuery(query());

    const entry = readAndScrubAuthorizationEntry(window);

    expect(window.location.search).toBe("");
    expect(entry).toEqual({ status: "invalid" });
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith("authorize.parse.failed", {
      source: "query",
      code: expect.any(String),
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(SECRET);
  });
});

function setAuthorizationUrl(request: string): void {
  window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(request)}`);
}

function setRawAuthorizationQuery(query: string): void {
  window.history.replaceState({}, "", `/authorize?${query}`);
}

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=${SECRET}`;
}
