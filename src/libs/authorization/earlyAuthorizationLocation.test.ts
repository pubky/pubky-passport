import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
  EARLY_AUTHORIZATION_LOCATION_SCRIPT,
} from "./earlyAuthorizationLocation";

describe("early authorization location bootstrap", () => {
  afterEach(() => vi.useRealTimers());

  it("scrubs and exposes an authorization fragment exactly once", () => {
    const context = createContext("", "#d=sensitive");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

    expect(context.location).toMatchObject({ pathname: "/authorize", search: "", hash: "" });
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
    expect(takeCapture(context)).toEqual({ status: "invalid_search" });
    // A rejected request stays on the entry, which explains the rejection.
    expect(context.navigations).toEqual(["replaceState:/authorize"]);
  });

  it("rejects a plain query next to a request fragment", () => {
    const context = createContext("?utm_source=newsletter", "#d=fragment-canary");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);
    expect(takeCapture(context)).toEqual({ status: "invalid_search" });
    expect(context.location).toMatchObject({ search: "", hash: "" });
  });

  it.each([
    ["no request", ""],
    ["a plain query", "?utm_source=newsletter&ref=canary"],
  ])("leaves an entry with %s for the home page before any app code runs", (_case, search) => {
    const context = createContext(search, "");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);
    expect(context.navigations).toEqual(["replaceState:/authorize", "stop", "replace:/"]);
    expect(context.location).toMatchObject({ search: "", hash: "" });
    expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
  });

  it("leaves an entry without a request for the home page even when scrubbing fails", () => {
    const context = createContext("", "", { replaceStateThrows: true });
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);
    expect(context.navigations).toEqual(["stop", "replace:/"]);
  });

  it("rejects legacy query transport even without a fragment", () => {
    const context = createContext("?d=query-canary", "");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);
    expect(takeCapture(context)).toEqual({ status: "invalid_search" });
  });

  it("captures the fragment size limit and rejects limit plus one without retaining it", () => {
    const canary = "secret-canary";
    const atLimit = `#${"a".repeat(32_768 - canary.length - 1)}${canary}`;
    const accepted = createContext("", atLimit);
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, accepted);
    const takeAccepted = accepted[EARLY_AUTHORIZATION_LOCATION_PROPERTY];
    if (typeof takeAccepted !== "function") throw new Error("Expected authorization capture");
    expect(takeAccepted()).toMatchObject({ status: "captured", hash: atLimit });

    const rejected = createContext("", `${atLimit}x`);
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, rejected);
    expect(takeCapture(rejected, canary)).toEqual({ status: "too_large" });
  });

  it("discards an unconsumed capture and returns an expired marker", async () => {
    vi.useFakeTimers();
    const context = createContext("", "#d=sensitive");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

    await vi.advanceTimersByTimeAsync(60_000);

    const take = context[EARLY_AUTHORIZATION_LOCATION_PROPERTY];
    expect(typeof take).toBe("function");
    if (typeof take !== "function") throw new Error("Expected expired authorization marker");
    expect(take()).toEqual({ status: "expired" });
    expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
  });

  it("stops loading and drops the request for a clean home page when native scrubbing fails", () => {
    const context = createContext("", "#d=sensitive", { replaceStateThrows: true });

    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

    expect(context.navigations).toEqual(["stop", "replace:/"]);
    expect(context.location.hash).toBe("");
    expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
  });

  it("still navigates to a clean URL when stopping the page throws", () => {
    const context = createContext("", "#d=sensitive", {
      replaceStateThrows: true,
      stopThrows: true,
    });

    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

    expect(context.navigations).toEqual(["stop", "replace:/"]);
    expect(context.location.hash).toBe("");
    expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
  });

  it("reloads the entry when a later fragment navigation brings a new request", () => {
    const context = createContext("", "#d=first");
    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);
    takeCapture(context);

    context.location.hash = "";
    context.dispatch("hashchange");
    expect(context.location.reload).not.toHaveBeenCalled();

    context.location.hash = "#d=second";
    context.dispatch("hashchange");
    expect(context.location.reload).toHaveBeenCalledOnce();
  });

  describe("on the home page", () => {
    it.each([
      ["a request fragment", "", "#d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dcanary"],
      ["a percent-encoded key", "", "#%64=pubkyauth%3A%2F%2Fsignin"],
      ["a later d parameter", "", "#x=1&d=pubkyauth%3A%2F%2Fsignin"],
      ["a bare link", "", "#pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dcanary"],
    ])("forwards %s to the entry before any app code runs", (_case, search, hash) => {
      const context = createContext(search, hash, { pathname: "/" });

      runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

      expect(context.navigations).toEqual(["replaceState:/", "stop", `replace:/authorize${hash}`]);
      expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
      expect(context.listeners).toEqual({});
    });

    it.each([
      ["legacy query transport", "?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dcanary", ""],
      ["a query next to a request", "?utm_source=canary", "#d=pubkyauth%3A%2F%2Fsignin"],
    ])("forwards %s for rejection without the query's contents", (_case, search, hash) => {
      const context = createContext(search, hash, { pathname: "/" });

      runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

      expect(context.navigations).toEqual([
        "replaceState:/",
        "stop",
        `replace:/authorize?d=${hash}`,
      ]);
      expect(context.navigations.join()).not.toContain("canary");
    });

    it("keeps the scrub when forwarding fails", () => {
      const context = createContext("", "#d=canary", { pathname: "/", replaceThrows: true });

      runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

      expect(context.location).toMatchObject({ pathname: "/", hash: "" });
      expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
    });

    it.each([
      ["an empty location", "", ""],
      ["an ordinary anchor", "", "#top"],
      ["an analytics query", "?utm_source=pubkyauth-campaign", ""],
      ["a Google credential", "", "#access_token=token&state=state"],
    ])("leaves %s to the page", (_case, search, hash) => {
      const context = createContext(search, hash, { pathname: "/" });

      runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

      expect(context.navigations).toEqual([]);
      expect(context.location).toMatchObject({ pathname: "/", search, hash });
      expect(context[EARLY_AUTHORIZATION_LOCATION_PROPERTY]).toBeUndefined();
    });

    it("forwards a same-document navigation to a request without stopping the page", () => {
      const context = createContext("", "", { pathname: "/" });
      runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

      context.location.hash = "#top";
      context.dispatch("hashchange");
      expect(context.navigations).toEqual([]);

      context.location.hash = "#d=canary";
      context.dispatch("hashchange");
      expect(context.navigations).toEqual(["replaceState:/", "replace:/authorize#d=canary"]);
    });
  });

  it("ignores every other route", () => {
    const context = createContext("", "#d=canary", { pathname: "/privacy-policy" });

    runInNewContext(EARLY_AUTHORIZATION_LOCATION_SCRIPT, context);

    expect(context.navigations).toEqual([]);
    expect(context.location.hash).toBe("#d=canary");
    expect(context.listeners).toEqual({});
  });
});

type TestLocation = {
  pathname: string;
  search: string;
  hash: string;
  replace: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
};

type TestContext = Record<string, unknown> & {
  location: TestLocation;
  navigations: string[];
  listeners: Record<string, Array<() => void>>;
  dispatch: (type: string) => void;
};

/** A parser-time window whose navigations are recorded in call order. */
function createContext(
  search: string,
  hash: string,
  options: {
    pathname?: string;
    replaceStateThrows?: boolean;
    replaceThrows?: boolean;
    stopThrows?: boolean;
  } = {},
): TestContext {
  const navigations: string[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  const location: TestLocation = {
    pathname: options.pathname ?? "/authorize",
    search,
    hash,
    replace: vi.fn((url: string) => {
      navigations.push(`replace:${url}`);
      if (options.replaceThrows) throw new Error("unavailable");
      location.search = "";
      location.hash = "";
    }),
    reload: vi.fn(),
  };
  const context: TestContext = {
    location,
    navigations,
    listeners,
    history: {},
    History: {
      prototype: {
        replaceState(_state: unknown, _title: string, url: string) {
          if (options.replaceStateThrows) throw new Error("unavailable");
          navigations.push(`replaceState:${url}`);
          location.pathname = url;
          location.search = "";
          location.hash = "";
        },
      },
    },
    stop: () => {
      navigations.push("stop");
      if (options.stopThrows) throw new Error("unavailable");
    },
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, listener: () => void) => {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      const remaining = (listeners[type] ?? []).filter((candidate) => candidate !== listener);
      if (remaining.length > 0) listeners[type] = remaining;
      else delete listeners[type];
    },
    dispatch: (type: string) => listeners[type]?.forEach((listener) => listener()),
  };
  context.window = context;
  return context;
}

/** Takes the one-shot capture and checks that it retained none of the request. */
function takeCapture(context: TestContext, canary = "canary"): unknown {
  const take = context[EARLY_AUTHORIZATION_LOCATION_PROPERTY];
  if (typeof take !== "function") throw new Error("Expected an early capture");
  const captured: unknown = take();
  expect(JSON.stringify(captured)).not.toContain(canary);
  return captured;
}
