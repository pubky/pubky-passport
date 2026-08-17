import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS,
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
  EARLY_AUTHORIZATION_LOCATION_SCRIPT,
} from "./earlyAuthorizationLocation";

describe("early authorization location bootstrap", () => {
  afterEach(() => vi.useRealTimers());

  it("scrubs and exposes an authorization fragment exactly once", () => {
    const context = createContext("", "#d=sensitive");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

    expect(context.location).toEqual({ pathname: "/authorize", search: "", hash: "" });
    const take = context[EARLY_AUTHORIZATION_LOCATION_PROPERTY];
    expect(typeof take).toBe("function");
    if (typeof take !== "function") throw new Error("Expected early authorization capture");
    expect(take()).toEqual({
      status: "captured",
      hash: "#d=sensitive",
      expiresAt: expect.any(Number),
    });
    expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
  });

  it("rejects a query without reading or retaining the fragment", () => {
    const context = createContext("?d=query-canary", "#d=fragment-canary");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);
    const take = context[EARLY_AUTHORIZATION_LOCATION_PROPERTY];
    if (typeof take !== "function") throw new Error("Expected rejected query marker");
    const captured = take();
    expect(captured).toEqual({ status: "invalid_search" });
    expect(JSON.stringify(captured)).not.toContain("canary");
  });

  it("discards an unconsumed capture and returns an expired marker", async () => {
    vi.useFakeTimers();
    const context = createContext("", "#d=sensitive");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

    await vi.advanceTimersByTimeAsync(EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS);

    const take = context[EARLY_AUTHORIZATION_LOCATION_PROPERTY];
    expect(typeof take).toBe("function");
    if (typeof take !== "function") throw new Error("Expected expired authorization marker");
    expect(take()).toEqual({ status: "expired" });
    expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
  });
});

function createContext(search: string, hash: string): Record<string, unknown> & {
  location: { pathname: string; search: string; hash: string };
} {
  const location = { pathname: "/authorize", search, hash };
  const context: Record<string, unknown> & { location: typeof location } = {
    location,
    history: {},
    History: { prototype: { replaceState() { location.search = ""; location.hash = ""; } } },
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  context.window = context;
  return context;
}
