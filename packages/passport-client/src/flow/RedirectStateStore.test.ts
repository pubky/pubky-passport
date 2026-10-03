import { expect, test, vi } from "vitest";
import { RedirectStateStore } from "./RedirectStateStore.js";
import type { RedirectRecord } from "./parseRedirectRecord.js";

const KEY = "pubky-passport:redirect:v1";
const DEFAULT = "https://passport.example";
const INSTANCE = Object.freeze({ origin: DEFAULT, host: "passport.example", isCustom: false });
const CLIENT = JSON.stringify(["Client", "", "client.example", DEFAULT, "required"]);
const FOREIGN = JSON.stringify(["Other", "", "other-client", DEFAULT, "required"]);
const NOW = 2_000_000;
/** Saved state lives at most thirty minutes, for every client. */
const TTL = 1_800_000;
const CANARY = ["saved", "private", "opaque", "state"].join("-");

test.each([
  { client: CLIENT, attemptId: "A".repeat(22), removed: true },
  { client: CLIENT, attemptId: "B".repeat(22), removed: false },
  { client: FOREIGN, attemptId: "A".repeat(22), removed: false },
])("captured-attempt cleanup preserves other slots (%#)", ({ client, attemptId, removed }) => {
  const raw = JSON.stringify(record({ client, attemptId }));
  const h = setup(raw);
  h.store.deleteOwned("A".repeat(22));
  expect(h.values.get(KEY)).toBe(removed ? undefined : raw);
  expect(h.storage.removeItem).toHaveBeenCalledTimes(removed ? 1 : 0);
});

function record(change: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    v: 1,
    attemptId: "abcdefghijklmnopqrstuv",
    client: CLIENT,
    state: CANARY,
    instance: DEFAULT,
    createdAt: NOW,
    ...change,
  };
}
const input = () => ({ attemptId: record().attemptId, state: CANARY, instance: INSTANCE });
function setup(raw: string | null = null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(KEY, raw);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const getStorage = vi.fn(() => storage);
  const clock = { now: vi.fn(() => NOW) };
  const store = new RedirectStateStore({
    storage: getStorage,
    clock,
    client: CLIENT,
    defaultOrigin: DEFAULT,
  });
  return { store, storage, getStorage, clock, values };
}

test("construction is lazy; saving stamps the injected clock once in the exact v1 slot", () => {
  const h = setup();
  expect(h.getStorage).not.toHaveBeenCalled();
  expect(h.clock.now).not.toHaveBeenCalled();
  expect(h.store.save(input())).toBe(true);
  expect(h.clock.now).toHaveBeenCalledOnce();
  expect(h.storage.setItem).toHaveBeenCalledExactlyOnceWith(KEY, JSON.stringify(record()));
  expect(h.storage.getItem).toHaveBeenCalledExactlyOnceWith(KEY);
  expect(h.storage.removeItem).not.toHaveBeenCalled();
});

test("save keeps the SDK's delegated state opaque, without reserializing it", () => {
  const h = setup();
  const opaque = JSON.stringify({ keyId: CANARY, nested: [null, 1, "\u0000"] });
  expect(h.store.save({ ...input(), state: opaque })).toBe(true);
  expect(JSON.parse(h.values.get(KEY)!).state).toBe(opaque);
  expect(h.store.read()).toEqual({
    kind: "owned",
    record: record({ state: opaque }),
    instance: INSTANCE,
    eligible: true,
  });
});

test("a chosen Passport is restored as custom; the app's own as its default", () => {
  const custom = "https://custom.example";
  const h = setup(JSON.stringify(record({ instance: custom })));
  expect(h.store.read()).toMatchObject({
    kind: "owned",
    instance: { origin: custom, host: "custom.example", isCustom: true },
  });
});

test.each([
  "http://passport.example",
  "https://custom.example/path",
  "https://localhost:3001",
  "not a url",
])("an owned record naming no valid Passport %s is discarded as malformed", (instance) => {
  const h = setup(JSON.stringify(record({ instance })));
  expect(h.store.read()).toEqual({ kind: "malformed" });
  expect(h.storage.removeItem).toHaveBeenCalledExactlyOnceWith(KEY);
});

test("loopback is allowed only for the app's own Passport (development)", () => {
  const values = new Map([[KEY, JSON.stringify(record({ instance: "http://localhost:3001" }))]]);
  const store = new RedirectStateStore({
    storage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => {},
      removeItem: (key: string) => void values.delete(key),
    }),
    clock: { now: () => NOW },
    client: CLIENT,
    defaultOrigin: "http://localhost:3001",
  });
  expect(store.read()).toMatchObject({
    kind: "owned",
    instance: { origin: "http://localhost:3001", isCustom: false },
  });
});

test.each([
  { age: 0, eligible: true },
  { age: TTL, eligible: true },
  { age: TTL + 1, eligible: false },
  { age: -1, eligible: false },
])("owned age $age uses one reading of the clock ($eligible)", ({ age, eligible }) => {
  const saved = record({ createdAt: NOW - age });
  const h = setup(JSON.stringify(saved));
  expect(h.store.read()).toEqual({ kind: "owned", record: saved, instance: INSTANCE, eligible });
  expect(h.clock.now).toHaveBeenCalledOnce();
  expect(h.storage.removeItem).not.toHaveBeenCalled();
});

test.each([0, NOW + 1, Number.MAX_SAFE_INTEGER])(
  "fingerprint precedes age for foreign createdAt=%s",
  (createdAt) => {
    const raw = JSON.stringify(record({ client: FOREIGN, createdAt }));
    const h = setup(raw);
    expect(h.store.read()).toEqual({ kind: "foreign" });
    expect(h.clock.now).not.toHaveBeenCalled();
    expect(h.storage.removeItem).not.toHaveBeenCalled();
    expect(h.values.get(KEY)).toBe(raw);
  },
);

test("another client's record is left alone whatever its Passport", () => {
  const raw = JSON.stringify(record({ client: FOREIGN, instance: "http://localhost:9999" }));
  const h = setup(raw);
  expect(h.store.read()).toEqual({ kind: "foreign" });
  expect(h.values.get(KEY)).toBe(raw);
});

test.each(["{", "null", JSON.stringify({ ...record(), createdAt: -1 })])(
  "malformed structure is discarded before ownership or age (%#)",
  (raw) => {
    const h = setup(raw);
    expect(h.store.read()).toEqual({ kind: "malformed" });
    expect(h.clock.now).not.toHaveBeenCalled();
    expect(h.storage.removeItem).toHaveBeenCalledExactlyOnceWith(KEY);
  },
);

const sweepCases = [
  { name: "own at TTL", saved: record({ createdAt: NOW - TTL }), remove: false },
  {
    name: "own TTL+1",
    saved: record({ createdAt: NOW - TTL - 1 }),
    remove: true,
    attributed: true,
  },
  { name: "own future", saved: record({ createdAt: NOW + 1 }), remove: true, attributed: true },
  {
    name: "own max safe",
    saved: record({ createdAt: Number.MAX_SAFE_INTEGER }),
    remove: true,
    attributed: true,
  },
  {
    name: "foreign at TTL",
    saved: record({ client: FOREIGN, createdAt: NOW - TTL }),
    remove: false,
  },
  {
    name: "foreign TTL+1",
    saved: record({ client: FOREIGN, createdAt: NOW - TTL - 1 }),
    remove: true,
    attributed: false,
  },
  {
    name: "foreign future",
    saved: record({ client: FOREIGN, createdAt: NOW + 1 }),
    remove: true,
    attributed: false,
  },
];
test.each(sweepCases)(
  "markerless startup sweeps $name exactly once",
  ({ saved, remove, attributed }) => {
    const raw = JSON.stringify(saved);
    const h = setup(raw);
    const diagnostic = h.store.sweep(false);
    expect(diagnostic).toEqual(
      remove
        ? {
            code: "redirect_state_discarded",
            ...(attributed ? { attemptId: saved.attemptId } : {}),
          }
        : undefined,
    );
    expect(h.storage.getItem).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(h.clock.now).toHaveBeenCalledOnce();
    expect(h.storage.removeItem).toHaveBeenCalledTimes(remove ? 1 : 0);
    expect(h.values.get(KEY)).toBe(remove ? undefined : raw);
    expect(JSON.stringify(diagnostic ?? null)).not.toContain(CANARY);
    expect(h.store.sweep(false)).toBeUndefined();
    expect(h.storage.getItem).toHaveBeenCalledTimes(1);
    expect(h.clock.now).toHaveBeenCalledTimes(1);
  },
);

test.each([null, "{", ...sweepCases.map(({ saved }) => JSON.stringify(saved))])(
  "any valid marker suspends the whole sweep for this load (%#)",
  (raw) => {
    const h = setup(raw);
    expect(h.store.sweep(true)).toBeUndefined();
    expect(h.store.sweep(false)).toBeUndefined();
    expect(h.getStorage).not.toHaveBeenCalled();
    expect(h.clock.now).not.toHaveBeenCalled();
    expect(h.values.get(KEY)).toBe(raw ?? undefined);
  },
);

test("skipping the sweep preserves own expired/mismatched data for return classification", () => {
  const saved = record({ createdAt: NOW - TTL - 1 });
  const h = setup(JSON.stringify(saved));
  h.store.sweep(true);
  expect(h.store.read()).toEqual({
    kind: "owned",
    record: saved,
    instance: INSTANCE,
    eligible: false,
  });
  expect(h.storage.removeItem).not.toHaveBeenCalled();
});

test.each([null, "{"])("empty/malformed sweep has no attribution or clock read (%#)", (raw) => {
  const h = setup(raw);
  expect(h.store.sweep(false)).toBeUndefined();
  expect(h.clock.now).not.toHaveBeenCalled();
  expect(h.storage.removeItem).toHaveBeenCalledTimes(raw === null ? 0 : 1);
});

test.each(["getter", "read", "remove"] as const)(
  "a throwing %s is contained without exposing saved state",
  (failure) => {
    const h = setup(JSON.stringify(record({ createdAt: NOW - TTL - 1 })));
    const throws = () => {
      throw new Error(CANARY);
    };
    if (failure === "getter") h.getStorage.mockImplementation(throws);
    if (failure === "read") h.storage.getItem.mockImplementation(throws);
    if (failure === "remove") h.storage.removeItem.mockImplementation(throws);
    const diagnostic = h.store.sweep(false);
    expect(diagnostic).toEqual(
      failure === "remove"
        ? { code: "redirect_state_discarded", attemptId: record().attemptId }
        : undefined,
    );
    expect(JSON.stringify(diagnostic ?? null)).not.toContain(CANARY);
    if (failure !== "remove") expect(h.store.read()).toEqual({ kind: "none" });
  },
);

test("malformed deletion failure does not turn the slot into a resumable record", () => {
  const h = setup("{");
  h.storage.removeItem.mockImplementation(() => {
    throw new Error(CANARY);
  });
  expect(h.store.read()).toEqual({ kind: "malformed" });
});

test.each(["getter", "write", "noop", "readback"] as const)(
  "a %s save failure returns false without an exception or diagnostic body",
  (failure) => {
    const h = setup();
    const throws = () => {
      throw new Error(CANARY);
    };
    if (failure === "getter") h.getStorage.mockImplementation(throws);
    if (failure === "write") h.storage.setItem.mockImplementation(throws);
    if (failure === "noop") h.storage.setItem.mockImplementation(() => {});
    if (failure === "readback") h.storage.getItem.mockImplementation(throws);
    expect(h.store.save(input())).toBe(false);
  },
);

test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
  "invalid clock stamp %s is never persisted",
  (now) => {
    const h = setup();
    h.clock.now.mockReturnValue(now);
    expect(h.store.save(input())).toBe(false);
    expect(h.storage.setItem).not.toHaveBeenCalled();
  },
);

test("the default clock remains lazy and stamps the system time at save", () => {
  const h = setup();
  const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
  try {
    const store = new RedirectStateStore({
      storage: h.getStorage,
      client: CLIENT,
      defaultOrigin: DEFAULT,
    });
    expect(now).not.toHaveBeenCalled();
    expect(store.save(input())).toBe(true);
    expect(now).toHaveBeenCalledOnce();
    expect(JSON.parse(h.values.get(KEY)!).createdAt).toBe(NOW);
  } finally {
    now.mockRestore();
  }
});

test("a throwing clock permits neither a save nor eligibility and cannot interrupt best-effort sweep", () => {
  const saved = record();
  const raw = JSON.stringify(saved);
  const h = setup(raw);
  h.clock.now.mockImplementation(() => {
    throw new Error(CANARY);
  });
  expect(h.store.save(input())).toBe(false);
  expect(h.store.read()).toEqual({
    kind: "owned",
    record: saved,
    instance: INSTANCE,
    eligible: false,
  });
  expect(h.store.sweep(false)).toBeUndefined();
  expect(h.values.get(KEY)).toBe(raw);
  expect(h.storage.setItem).not.toHaveBeenCalled();
  expect(h.storage.removeItem).not.toHaveBeenCalled();
});

test.each([Infinity, -Infinity, NaN])(
  "a nonfinite clock %s cannot justify deleting a stored record",
  (now) => {
    const raw = JSON.stringify(record());
    const h = setup(raw);
    h.clock.now.mockReturnValue(now);
    expect(h.store.sweep(false)).toBeUndefined();
    expect(h.storage.removeItem).not.toHaveBeenCalled();
    expect(h.values.get(KEY)).toBe(raw);
  },
);

test("invalid save input does not overwrite an existing foreign record", () => {
  const raw = JSON.stringify(record({ client: FOREIGN }));
  const h = setup(raw);
  expect(h.store.save({ ...input(), state: "" })).toBe(false);
  expect(h.storage.setItem).not.toHaveBeenCalled();
  expect(h.values.get(KEY)).toBe(raw);
});
