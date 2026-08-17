/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS,
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
} from "../../../libs/authorization/earlyAuthorizationLocation";

const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("authorizationEntryBootstrap", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    window.history.replaceState({}, "", "/");
  });

  it("releases an unconsumed request and returns an expired marker", async () => {
    vi.useFakeTimers();
    window.history.replaceState(
      {},
      "",
      `/authorize#d=${encodeURIComponent(validRequest())}`,
    );
    const bootstrap = await import("./authorizationEntryBootstrap");

    vi.advanceTimersByTime(EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS);

    expect(bootstrap.takeInitialAuthorizationEntry()).toEqual({ status: "expired" });
    expect(window.location.hash).toBe("");
  });

  it("uses the original capture deadline instead of restarting it", async () => {
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
    const bootstrap = await import("./authorizationEntryBootstrap");

    vi.advanceTimersByTime(1_000);

    expect(bootstrap.takeInitialAuthorizationEntry()).toEqual({ status: "expired" });
  });

  it("checks wall-clock expiry when a throttled timer has not run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    window.history.replaceState(
      {},
      "",
      `/authorize#d=${encodeURIComponent(validRequest())}`,
    );
    const bootstrap = await import("./authorizationEntryBootstrap");

    vi.setSystemTime(new Date(EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS + 1));

    expect(bootstrap.takeInitialAuthorizationEntry()).toEqual({ status: "expired" });
  });
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`;
}
