/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
} from "../../../../libs/authorization/earlyAuthorizationLocation";
import { IssuedPubkyAuthRequest } from "../request/IssuedPubkyAuthRequest";

const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("authorizationEntryBootstrap", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    window.history.replaceState({}, "", "/");
  });

  it("retains a parsed request without a review deadline", async () => {
    vi.useFakeTimers();
    window.history.replaceState(
      {},
      "",
      `/authorize#d=${encodeURIComponent(validRequest())}`,
    );
    const bootstrap = await import("./authorizationEntryBootstrap");

    vi.advanceTimersByTime(24 * 60 * 60_000);

    const entry = bootstrap.takeInitialAuthorizationEntry();
    expect(entry?.status).toBe("valid");
    if (entry?.status === "valid") IssuedPubkyAuthRequest.release(entry.request);
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
    const bootstrap = await import("./authorizationEntryBootstrap");

    vi.advanceTimersByTime(24 * 60 * 60_000);

    const entry = bootstrap.takeInitialAuthorizationEntry();
    expect(entry?.status).toBe("valid");
    if (entry?.status === "valid") IssuedPubkyAuthRequest.release(entry.request);
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
    const bootstrap = await import("./authorizationEntryBootstrap");

    expect(bootstrap.takeInitialAuthorizationEntry()).toEqual({ status: "expired" });
  });
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`;
}
