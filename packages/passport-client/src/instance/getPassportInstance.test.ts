import { afterEach, expect, test, vi } from "vitest";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { DEFAULT_PASSPORT_INSTANCE } from "../shared/defaults.js";
import { getPassportInstance, passportInstanceFrom } from "./getPassportInstance.js";
import type { ChoiceStorage } from "./instanceChoiceStore.js";
import { InstanceResolver } from "./InstanceResolver.js";

const D = "https://passport.example";
const C = "https://custom.example";
const KEY = `pubky-passport:instance:${D}`;

/** The element's settings picker: the resolver every client uses, over the same storage. */
function choose(input: string, getStorage: () => ChoiceStorage = () => window.localStorage) {
  return new InstanceResolver(
    resolveClientOptions({ instance: D }, (caps) => caps),
    getStorage,
  ).setInstance(input);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

test("without a choice it returns the normalized default, else the public Passport", () => {
  expect(getPassportInstance()).toBe(DEFAULT_PASSPORT_INSTANCE);
  expect(getPassportInstance("PASSPORT.example:443/")).toBe(D);
});

test("returns the Passport the person chose in the element's settings for that default", () => {
  expect(choose("custom.example")).toMatchObject({ ok: true });
  expect(getPassportInstance(D)).toBe(C);
  expect(getPassportInstance("passport.example")).toBe(C);
  // A choice belongs to the app's own Passport: another default has none.
  expect(getPassportInstance("https://other.example")).toBe("https://other.example");
  expect(getPassportInstance()).toBe(DEFAULT_PASSPORT_INSTANCE);
  // Choosing the app's own Passport again clears it.
  expect(choose(D)).toMatchObject({ ok: true });
  expect(getPassportInstance(D)).toBe(D);
});

test.each(["http://custom.example", "https://127.0.0.1", "https://custom.example/path", "x y"])(
  "ignores a stored choice that no longer validates (%s) and leaves it in place",
  (stored) => {
    window.localStorage.setItem(KEY, stored);
    expect(getPassportInstance(D)).toBe(D);
    expect(window.localStorage.getItem(KEY)).toBe(stored);
  },
);

test.each([["http://localhost:3000"], [""], ["https://passport.example/path"], [5], [null]])(
  "treats an invalid default (%j) as unset",
  (input) => {
    expect(passportInstanceFrom(input, () => window.localStorage)).toBe(DEFAULT_PASSPORT_INSTANCE);
  },
);

test("never throws when storage is unavailable", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  expect(getPassportInstance(D)).toBe(D);
  const throwing = {
    getItem: () => {
      throw new Error("denied");
    },
  } as unknown as ChoiceStorage;
  expect(passportInstanceFrom(D, () => throwing)).toBe(D);
});
