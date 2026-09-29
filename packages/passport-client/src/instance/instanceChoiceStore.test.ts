// @vitest-environment node
import { expect, test, vi } from "vitest";
import { createInstanceChoiceStore } from "./instanceChoiceStore.js";

const D = "https://passport.example";
const key = `pubky-passport:instance:${D}`;
const now = 100_000;
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const ignored = vi.fn();
  const getStorage = vi.fn(() => storage);
  return {
    values,
    storage,
    ignored,
    getStorage,
    store: createInstanceChoiceStore(D, getStorage, ignored, () => now),
  };
}
const record = (savedAt = now) => ({ v: 1, origin: "https://custom.example", savedAt });

test("obtains storage lazily, writes only the scoped record and removes on reset", () => {
  const f = fixture();
  expect(f.getStorage).not.toHaveBeenCalled();
  expect(f.store.read()).toBeUndefined();
  expect(f.storage.setItem).not.toHaveBeenCalled();
  f.store.write("https://custom.example");
  expect([...f.values.keys()]).toEqual([key]);
  expect(JSON.parse(f.values.get(key)!)).toEqual(record());
  expect(f.store.read()).toBe("https://custom.example");
  f.store.clear();
  expect(f.store.read()).toBeUndefined();
  expect(f.storage.removeItem).toHaveBeenCalledWith(key);
});

test.each([
  "",
  "null",
  "[]",
  "bad-json",
  "1",
  '"text"',
  JSON.stringify({ ...record(), v: 2 }),
  JSON.stringify({ ...record(), extra: true }),
  JSON.stringify({ v: 1, origin: "https://custom.example" }),
  JSON.stringify({ ...record(), origin: 5 }),
  JSON.stringify({ ...record(), savedAt: "100000" }),
  JSON.stringify({ ...record(), savedAt: null }),
  JSON.stringify(record(now + 60_001)),
  '{"v":1,"origin":"https://custom.example","savedAt":1e400}',
])("deletes a malformed record and reports no raw value: %#", (value) => {
  const f = fixture();
  f.values.set(key, value);
  expect(f.store.read()).toBeUndefined();
  expect(f.values.has(key)).toBe(false);
  expect(f.ignored).toHaveBeenCalledExactlyOnceWith();
});

test.each([now + 60_000, -1, 0])("accepts the future boundary and has no expiry: %s", (time) => {
  const f = fixture();
  f.values.set(key, JSON.stringify(record(time)));
  expect(f.store.read()).toBe("https://custom.example");
  expect(f.ignored).not.toHaveBeenCalled();
});

test.each(["getter", "getItem", "setItem", "removeItem"] as const)(
  "keeps a page-local choice when %s throws",
  (operation) => {
    const f = fixture();
    const fail = () => {
      throw new Error("blocked storage");
    };
    if (operation === "getter") f.getStorage.mockImplementation(fail);
    else f.storage[operation].mockImplementation(fail);
    if (operation === "getItem") expect(f.store.read()).toBeUndefined();
    f.store.write("https://custom.example");
    expect(f.store.read()).toBe("https://custom.example");
    f.store.clear();
    expect(f.store.read()).toBeUndefined();
  },
);

test("rereads writable storage and isolates different developer defaults", () => {
  const f = fixture();
  f.values.set(key, JSON.stringify(record()));
  expect(f.store.read()).toBe("https://custom.example");
  f.values.set(key, JSON.stringify({ ...record(), origin: "https://changed.example" }));
  expect(f.store.read()).toBe("https://changed.example");
  const other = createInstanceChoiceStore("https://other.example", f.getStorage, f.ignored);
  expect(other.read()).toBeUndefined();
  other.clear();
  expect(f.store.read()).toBe("https://changed.example");
});

test("contains diagnostic callback failures after deleting malformed state", () => {
  const f = fixture();
  f.values.set(key, "invalid");
  f.ignored.mockImplementation(() => {
    throw new Error("observer failed");
  });
  expect(f.store.read()).toBeUndefined();
  expect(f.store.read()).toBeUndefined();
});

test("removes stale persisted choices after a failed write, later writes and reset", () => {
  const f = fixture();
  const fresh = () => createInstanceChoiceStore(D, f.getStorage, f.ignored, () => now);
  f.store.write("https://first.example");
  f.storage.setItem.mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  f.store.write("https://second.example");
  expect(f.store.read()).toBe("https://second.example");
  expect(fresh().read()).toBeUndefined();
  // Even if another tab writes while this store is in memory mode, reset must remove it.
  f.values.set(key, JSON.stringify(record()));
  f.store.write("https://third.example");
  expect(f.store.read()).toBe("https://third.example");
  expect(fresh().read()).toBeUndefined();
  f.values.set(key, JSON.stringify(record()));
  f.storage.removeItem.mockClear();
  f.store.clear();
  expect(f.storage.removeItem).toHaveBeenCalledExactlyOnceWith(key);
  expect(f.store.read()).toBeUndefined();
  expect(fresh().read()).toBeUndefined();
});

test("a choice removed by another tab does not return from page-local memory", () => {
  const f = fixture();
  f.store.write("https://custom.example");
  f.values.delete(key);
  expect(f.store.read()).toBeUndefined();
});
