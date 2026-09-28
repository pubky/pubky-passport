/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { EARLY_AUTHORIZATION_LOCATION_PROPERTY } from "./libs/authorization/earlyAuthorizationLocation";

const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("instrumentation-client authorization entry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.doUnmock("./client/logic/authorization/entry/authorizationEntry");
    window.history.replaceState({}, "", "/");
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
    const leave = vi.fn();
    vi.doMock("./client/logic/authorization/entry/authorizationEntry", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      leaveEmptyAuthorizationEntry: leave,
    }));
    window.history.replaceState({}, "", url);
    const bootstrap = await import("./instrumentation-client");

    expect(leave.mock.calls).toEqual(status === "empty" ? [[window]] : []);
    expect(bootstrap.takeInitialAuthorizationEntry()?.status).toBe(status);
  });

  it("neither reads nor forwards requests on other routes", async () => {
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
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`;
}
