import { expect, test, vi } from "vitest";
import { parseReturnMarker } from "../protocol/parseReturnMarker.js";
import { scrubReturnUrl } from "../protocol/scrubReturnUrl.js";
import { RedirectStateStore } from "./RedirectStateStore.js";
import type { RedirectRecord } from "./parseRedirectRecord.js";
import { takeRedirectReturn } from "./takeRedirectReturn.js";

const KEY = "pubky-passport:redirect:v1";
const APP = "https://app.example";
const CLIENT = JSON.stringify(["App", "", "app.example", "https://passport.example", "required"]);
const FOREIGN = JSON.stringify([
  "Other",
  "",
  "other.example",
  "https://passport.example",
  "required",
]);
const ID = "A".repeat(22);
const NOW = 2_000_000;
const TTL = 1_800_000;
const INSTANCE = { origin: "https://passport.example", host: "passport.example", isCustom: false };
const PRIVATE = ["return", "saved", "secret", "canary"].join("-");
function record(change: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    v: 1,
    client: CLIENT,
    attemptId: ID,
    state: PRIVATE,
    instance: "https://passport.example",
    createdAt: NOW,
    ...change,
  };
}
function setup(raw: string | null = JSON.stringify(record()), marker = `s.${ID}`) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(KEY, raw);
  const order: string[] = [];
  const storage = {
    getItem: vi.fn((key: string) => {
      order.push("get");
      return values.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      order.push("set");
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      order.push("remove");
      values.delete(key);
    }),
  };
  const getStorage = vi.fn(() => storage);
  const clock = { now: vi.fn(() => NOW) };
  const createStore = () =>
    new RedirectStateStore({
      storage: getStorage,
      clock,
      client: CLIENT,
      defaultOrigin: "https://passport.example",
    });
  const store = createStore();
  let url = new URL(`${APP}/return?keep=value&errorCode=app-code&errorMessage=app-message#hash`);
  if (marker) url.searchParams.set("pubky-passport", marker);
  const history = {
    state: { app: 1 },
    replaceState: vi.fn(
      (_state: unknown, _unused: string, clean: string | URL | null | undefined) => {
        order.push("scrub");
        url = new URL(String(clean));
      },
    ),
  };
  const scrub = vi.fn(() => scrubReturnUrl(url, history));
  const h = {
    store,
    createStore,
    values,
    storage,
    getStorage,
    clock,
    order,
    history,
    scrub,
    url: () => url,
    marker: () => parseReturnMarker(url.searchParams.get("pubky-passport")),
    take: () => takeRedirectReturn(store, h.marker(), scrub),
  };
  return h;
}

test.each(["s", "c", "e", "none"] as const)(
  "takes an eligible %s return synchronously before exposing saved state",
  (kind) => {
    const h = setup(undefined, kind === "none" ? "" : `${kind}.${ID}`);
    expect(h.take()).toEqual({
      kind: "resume",
      record: record(),
      instance: INSTANCE,
      marker: kind,
    });
    expect(h.order).toEqual(
      kind === "none" ? ["get", "remove", "get"] : ["get", "remove", "get", "scrub"],
    );
    expect(h.values.has(KEY)).toBe(false);
    expect(h.storage.setItem).not.toHaveBeenCalled();
    expect(h.clock.now).toHaveBeenCalledOnce();
    if (kind === "none") {
      expect(h.history.replaceState).not.toHaveBeenCalled();
      expect(h.url().searchParams.get("errorCode")).toBe("app-code");
      expect(h.url().searchParams.get("errorMessage")).toBe("app-message");
    } else expect(h.url().href).toBe(`${APP}/return?keep=value#hash`);
  },
);

test("preserves the opaque delegated resume input", () => {
  const saved = record({ state: JSON.stringify({ opaque: [PRIVATE, null] }) });
  const h = setup(JSON.stringify(saved));
  expect(h.take()).toEqual({ kind: "resume", record: saved, instance: INSTANCE, marker: "s" });
});

for (const marker of ["s", "c", "e", "none"] as const) {
  test.each(["remove", "noop", "readback"] as const)(
    `contains %s consume failure for ${marker}`,
    (mode) => {
      const h = setup(undefined, marker === "none" ? "" : `${marker}.${ID}`);
      if (mode === "remove")
        h.storage.removeItem.mockImplementation(() => {
          throw new Error(PRIVATE);
        });
      else h.storage.removeItem.mockImplementation(() => {});
      if (mode === "readback")
        h.storage.getItem
          .mockImplementationOnce((key) => h.values.get(key) ?? null)
          .mockImplementationOnce(() => {
            throw new Error(PRIVATE);
          });
      const outcome = h.take();
      expect(outcome).toEqual({
        kind: marker === "none" ? "none" : "invalid",
        diagnostic: { code: "redirect_state_discarded", attemptId: ID },
      });
      expect(JSON.stringify(outcome)).not.toContain(PRIVATE);
      expect(h.storage.setItem).not.toHaveBeenCalled();
      expect(h.history.replaceState).toHaveBeenCalledTimes(marker === "none" ? 0 : 1);
      expect(h.storage.removeItem).toHaveBeenCalledOnce();
      // The generic EndAttempt cleanup is a separate, best-effort attempt.
      if (marker !== "none") {
        h.storage.removeItem.mockImplementation((key) => {
          h.values.delete(key);
        });
        h.store.deleteOwned();
        expect(h.storage.removeItem).toHaveBeenCalledTimes(2);
        expect(h.values.has(KEY)).toBe(false);
        expect(outcome.kind).toBe("invalid");
      }
    },
  );
}

test("a fresh client with an undeletable record and scrubbed URL stays silent without resuming", () => {
  const h = setup();
  h.storage.removeItem.mockImplementation(() => {
    throw new Error(PRIVATE);
  });
  expect(h.take().kind).toBe("invalid");
  h.history.replaceState.mockClear();
  expect(takeRedirectReturn(h.createStore(), h.marker(), h.scrub)).toEqual({
    kind: "none",
    diagnostic: { code: "redirect_state_discarded", attemptId: ID },
  });
  expect(h.history.replaceState).not.toHaveBeenCalled();
});

test.each([false, true])("scrub failure is independent of consume failure=%s", (removeFails) => {
  const h = setup();
  h.scrub.mockImplementation(() => {
    throw new Error(PRIVATE);
  });
  if (removeFails)
    h.storage.removeItem.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
  const result = h.take();
  expect(h.scrub).toHaveBeenCalledOnce();
  expect(result).toEqual(
    removeFails
      ? { kind: "invalid", diagnostic: { code: "redirect_state_discarded", attemptId: ID } }
      : { kind: "resume", record: record(), instance: INSTANCE, marker: "s" },
  );
});

for (const marker of ["s", "c", "e", "none"] as const) {
  test.each([
    { name: "expired", change: { createdAt: NOW - TTL - 1 } },
    { name: "future", change: { createdAt: NOW + 1 } },
    { name: "max safe", change: { createdAt: Number.MAX_SAFE_INTEGER } },
  ])(`discards owned $name for ${marker}`, ({ change }) => {
    const h = setup(JSON.stringify(record(change)), marker === "none" ? "" : `${marker}.${ID}`);
    expect(h.take()).toEqual({
      kind: marker === "none" ? "none" : "invalid",
      diagnostic: { code: "redirect_state_discarded", attemptId: ID },
    });
    expect(h.values.has(KEY)).toBe(false);
    expect(h.history.replaceState).toHaveBeenCalledTimes(marker === "none" ? 0 : 1);
  });
}

test.each(["s", "c", "e"] as const)(
  "rejects a mismatched %s marker after consuming the owned record",
  (kind) => {
    const h = setup(undefined, `${kind}.${"B".repeat(22)}`);
    expect(h.take()).toEqual({
      kind: "invalid",
      diagnostic: { code: "redirect_state_discarded", attemptId: ID },
    });
    expect(h.values.has(KEY)).toBe(false);
    expect(h.history.replaceState).toHaveBeenCalledOnce();
  },
);

test("accepts the exact TTL boundary", () => {
  const saved = record({ createdAt: NOW - TTL });
  const h = setup(JSON.stringify(saved));
  expect(h.take()).toEqual({ kind: "resume", record: saved, instance: INSTANCE, marker: "s" });
});

test.each([0, NOW, NOW + 1])(
  "leaves foreign createdAt=%s and marker completely untouched",
  (createdAt) => {
    const raw = JSON.stringify(record({ client: FOREIGN, createdAt }));
    const h = setup(raw, `e.${"B".repeat(22)}`);
    const url = h.url().href;
    expect(h.take()).toEqual({ kind: "none" });
    expect(h.clock.now).not.toHaveBeenCalled();
    expect(h.storage.removeItem).not.toHaveBeenCalled();
    expect(h.scrub).not.toHaveBeenCalled();
    expect(h.url().href).toBe(url);
    expect(h.values.get(KEY)).toBe(raw);
    h.store.deleteOwned();
    expect(h.storage.removeItem).not.toHaveBeenCalled();
  },
);

test.each(["{", "null", JSON.stringify(record({ attemptId: ID + "\n" }))])(
  "discards malformed input %# and reports an invalid marked return",
  (raw) => {
    const h = setup(raw);
    expect(h.take()).toEqual({ kind: "invalid", diagnostic: { code: "redirect_state_discarded" } });
    expect(h.values.has(KEY)).toBe(false);
    expect(h.history.replaceState).toHaveBeenCalledOnce();
  },
);

test.each(["none", "storage", "read"] as const)(
  "uses the no-record row for %s without deleting unknown state",
  (mode) => {
    const h = setup(mode === "none" ? null : undefined);
    if (mode === "storage")
      h.getStorage.mockImplementation(() => {
        throw new Error(PRIVATE);
      });
    if (mode === "read")
      h.storage.getItem.mockImplementation(() => {
        throw new Error(PRIVATE);
      });
    expect(h.take()).toEqual({ kind: "stray" });
    expect(h.storage.removeItem).not.toHaveBeenCalled();
    expect(h.history.replaceState).toHaveBeenCalledOnce();
  },
);

test.each(["", `invalid.${ID}`, `s.${ID}\n`])(
  "never scrubs absent or invalid marker %#",
  (marker) => {
    const h = setup(null, marker);
    const before = h.url().href;
    expect(h.take()).toEqual({ kind: "none" });
    expect(h.url().href).toBe(before);
    expect(h.scrub).not.toHaveBeenCalled();
  },
);

test("generic deletion ignores eligibility and swallows native failures", () => {
  const h = setup(JSON.stringify(record({ createdAt: NOW + 1 })));
  h.storage.removeItem.mockImplementationOnce(() => {
    throw new Error(PRIVATE);
  });
  expect(() => h.store.deleteOwned()).not.toThrow();
  expect(h.storage.removeItem).toHaveBeenCalledOnce();
  expect(h.clock.now).not.toHaveBeenCalled();
  h.store.deleteOwned();
  expect(h.values.has(KEY)).toBe(false);
});

test("a storage getter failure during consume still attempts history cleanup", () => {
  const h = setup();
  h.getStorage.mockReturnValueOnce(h.storage).mockImplementationOnce(() => {
    throw new Error(PRIVATE);
  });
  expect(h.take()).toEqual({
    kind: "invalid",
    diagnostic: { code: "redirect_state_discarded", attemptId: ID },
  });
  expect(h.storage.removeItem).not.toHaveBeenCalled();
  expect(h.history.replaceState).toHaveBeenCalledOnce();
});

test("consume refuses a foreign record without accessing storage", () => {
  const h = setup();
  expect(h.store.consume(record({ client: FOREIGN }))).toBe(false);
  expect(h.getStorage).not.toHaveBeenCalled();
  expect(h.values.has(KEY)).toBe(true);
});

test.each(["s", "c", "e"] as const)(
  "startup marker %s preserves bad records for invalid-return classification",
  (kind) => {
    for (const raw of [
      JSON.stringify(record({ createdAt: NOW - TTL - 1 })),
      JSON.stringify(record({ createdAt: NOW + 1 })),
      JSON.stringify(record({ attemptId: "B".repeat(22) })),
      "{",
    ]) {
      const h = setup(raw, `${kind}.${ID}`);
      expect(h.store.sweep(true)).toBeUndefined();
      expect(h.storage.getItem).not.toHaveBeenCalled();
      expect(h.take().kind).toBe("invalid");
      expect(h.values.has(KEY)).toBe(false);
    }
  },
);

test.each(["owner", "non-owner"] as const)(
  "a marked expired record remains attributable when %s runs first",
  (first) => {
    const h = setup(JSON.stringify(record({ createdAt: 0 })));
    const foreign = new RedirectStateStore({
      storage: h.getStorage,
      clock: h.clock,
      client: FOREIGN,
      defaultOrigin: "https://passport.example",
    });
    h.store.sweep(true);
    foreign.sweep(true);
    const foreignScrub = vi.fn();
    const foreignReturn = () => takeRedirectReturn(foreign, h.marker(), foreignScrub);
    if (first === "non-owner") {
      expect(foreignReturn()).toEqual({ kind: "none" });
      expect(h.values.has(KEY)).toBe(true);
    }
    expect(h.take()).toEqual({
      kind: "invalid",
      diagnostic: { code: "redirect_state_discarded", attemptId: ID },
    });
    if (first === "owner") expect(foreignReturn()).toEqual({ kind: "none" });
    expect(foreignScrub).not.toHaveBeenCalled();
  },
);

test("a return read never saves, schedules or asynchronously postpones consumption", async () => {
  const h = setup();
  let microtaskRan = false;
  const pending = Promise.resolve().then(() => {
    microtaskRan = true;
  });
  const result = h.take();
  expect(microtaskRan).toBe(false);
  expect(result.kind).toBe("resume");
  expect(h.values.has(KEY)).toBe(false);
  expect(h.history.replaceState).toHaveBeenCalledOnce();
  expect(h.storage.setItem).not.toHaveBeenCalled();
  await pending;
});

test("a malformed record stays invalid when both cleanup calls fail", () => {
  const h = setup("{" + PRIVATE);
  h.storage.removeItem.mockImplementation(() => {
    throw new Error(PRIVATE);
  });
  h.scrub.mockImplementation(() => {
    throw new Error(PRIVATE);
  });
  const result = h.take();
  expect(result).toEqual({ kind: "invalid", diagnostic: { code: "redirect_state_discarded" } });
  expect(h.scrub).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test("a reload after successful consume and refused history sees a stray marker", () => {
  const h = setup();
  h.history.replaceState.mockImplementation(() => {
    throw new Error(PRIVATE);
  });
  expect(h.take().kind).toBe("resume");
  expect(h.values.has(KEY)).toBe(false);
  expect(h.marker()).toEqual({ kind: "s", attemptId: ID });
  expect(takeRedirectReturn(h.createStore(), h.marker(), h.scrub)).toEqual({ kind: "stray" });
});
