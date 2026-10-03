// @vitest-environment node
import { expect, test, vi } from "vitest";
import { createInstanceChoiceStore } from "./instanceChoiceStore.js";

const D = "https://passport.example";
const key = `pubky-passport:instance:${D}`;
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
  const getStorage = vi.fn(() => storage);
  return { values, storage, getStorage, store: createInstanceChoiceStore(D, getStorage) };
}

test("obtains storage lazily, writes only the bare origin under its key and removes on reset", () => {
  const f = fixture();
  expect(f.getStorage).not.toHaveBeenCalled();
  expect(f.store.read()).toBeUndefined();
  expect(f.storage.setItem).not.toHaveBeenCalled();
  f.store.write("https://custom.example");
  expect([...f.values.entries()]).toEqual([[key, "https://custom.example"]]);
  expect(f.store.read()).toBe("https://custom.example");
  f.store.clear();
  expect(f.store.read()).toBeUndefined();
  expect(f.storage.removeItem).toHaveBeenCalledWith(key);
});

test("returns whatever is stored: the resolver validates it", () => {
  const f = fixture();
  f.values.set(key, "not an origin");
  expect(f.store.read()).toBe("not an origin");
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
  f.values.set(key, "https://custom.example");
  expect(f.store.read()).toBe("https://custom.example");
  f.values.set(key, "https://changed.example");
  expect(f.store.read()).toBe("https://changed.example");
  const other = createInstanceChoiceStore("https://other.example", f.getStorage);
  expect(other.read()).toBeUndefined();
  other.clear();
  expect(f.store.read()).toBe("https://changed.example");
});

test("removes stale persisted choices after a failed write, later writes and reset", () => {
  const f = fixture();
  const fresh = () => createInstanceChoiceStore(D, f.getStorage);
  f.store.write("https://first.example");
  f.storage.setItem.mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  f.store.write("https://second.example");
  expect(f.store.read()).toBe("https://second.example");
  expect(fresh().read()).toBeUndefined();
  // Even if another tab writes while this store is in memory mode, reset must remove it.
  f.values.set(key, "https://custom.example");
  f.store.write("https://third.example");
  expect(f.store.read()).toBe("https://third.example");
  expect(fresh().read()).toBeUndefined();
  f.values.set(key, "https://custom.example");
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
