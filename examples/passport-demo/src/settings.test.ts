import { expect, it, vi } from "vitest";
import type { SignedIn } from "@pubky/passport-client";
import {
  DEFAULT_SETTINGS,
  elementAttributes,
  firstSignIn,
  loadSettings,
  passportOptions,
  saveSettings,
} from "./settings";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
};

it("round-trips the playground settings and defaults to the package's own Passport", () => {
  const storage = memory();
  expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  // Without VITE_PASSPORT_URL the options name no Passport, so the package's default applies.
  expect(DEFAULT_SETTINGS.instance).toBe("");
  expect(passportOptions(DEFAULT_SETTINGS)).not.toHaveProperty("instance");
  expect(elementAttributes(DEFAULT_SETTINGS).map(([name]) => name)).toEqual([
    "app-name",
    "client-id",
    "capabilities",
  ]);
  const next = {
    instance: "https://passport.example",
    profile: "optional" as const,
    variant: "small" as const,
  };
  saveSettings(next, storage);
  expect(loadSettings(storage)).toEqual(next);
  expect(elementAttributes(next)).toEqual([
    ["instance", "https://passport.example"],
    ["app-name", "Passport Demo"],
    ["client-id", "passport-demo"],
    ["capabilities", "/pub/passport-demo/:rw"],
    ["profile", "optional"],
  ]);
});

it.each(["not json", "null", JSON.stringify({ variant: "huge", profile: "sometimes" })])(
  "ignores invalid stored values: %s",
  (raw) => {
    const storage = memory();
    storage.values.set("passport-demo:playground:v5", raw);
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  },
);

it("takes the first Session on the page and signs a second one out", async () => {
  const show = vi.fn();
  const signIn = firstSignIn(show);
  const session = () => ({ signout: vi.fn(async () => {}), free: vi.fn() });
  const first = { session: session(), publicKey: "a", profile: null } as unknown as SignedIn;
  const second = { session: session(), publicKey: "b", profile: null } as unknown as SignedIn;
  expect(signIn.take(first)).toBe(true);
  // The headless view repeats its Session until reset(): the same one is neither shown nor ended.
  expect(signIn.take(first)).toBe(false);
  expect(signIn.take(second)).toBe(false);
  expect(show).toHaveBeenCalledExactlyOnceWith(first);
  await vi.waitFor(() => expect(second.session.free).toHaveBeenCalledOnce());
  expect(second.session.signout).toHaveBeenCalledOnce();
  expect(first.session.signout).not.toHaveBeenCalled();
  expect(signIn.end()).toBe(first);
  expect(signIn.end()).toBeUndefined();
  expect(signIn.take(second)).toBe(true);
});
