import { beforeEach, expect, it, vi } from "vitest";
import type { SignedIn } from "@pubky/passport-client";

// The SDK's session store, as passport.ts uses it; the SDK itself is not loaded.
const store = vi.hoisted(() => ({
  save: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  free: vi.fn(),
}));
vi.mock("@synonymdev/pubky", () => ({
  Pubky: class {
    get browserSessionStore() {
      return store;
    }
  },
}));
vi.mock("@pubky/passport-client/element", () => ({}));

import { keepSignIn, onSignIn, restoreSignIn, signOut } from "./passport";

const KEY = "passport-demo:signed-in";
const memory = new Map<string, string>();
const session = () => ({ signout: vi.fn(async () => {}), free: vi.fn() });
const signedIn = (s = session()): SignedIn =>
  ({ session: s, publicKey: "key", profile: { name: "Alice" } }) as unknown as SignedIn;

beforeEach(() => {
  vi.clearAllMocks();
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  });
  store.save.mockResolvedValue({ id: "stored-1", free: vi.fn() });
  store.remove.mockResolvedValue(undefined);
});

it("keeps the Session in the SDK store and frees the store's handles", async () => {
  const stored = { id: "stored-1", free: vi.fn() };
  store.save.mockResolvedValue(stored);
  await keepSignIn(signedIn());
  expect(JSON.parse(memory.get(KEY)!)).toEqual({
    id: "stored-1",
    publicKey: "key",
    profile: { name: "Alice" },
  });
  expect(stored.free).toHaveBeenCalledOnce();
  expect(store.free).toHaveBeenCalledOnce();
});

it("removes the stored record again when its ID cannot be kept", async () => {
  localStorage.setItem = () => {
    throw new Error("quota");
  };
  await expect(keepSignIn(signedIn())).rejects.toThrow("quota");
  expect(store.remove).toHaveBeenCalledWith("stored-1");
  expect(store.free).toHaveBeenCalledOnce();
});

it("restores a saved Session, and forgets it only when it is gone for good", async () => {
  memory.set(KEY, JSON.stringify({ id: "stored-1", publicKey: "key", profile: null }));
  const s = session();
  store.restore.mockResolvedValue(s);
  expect(await restoreSignIn()).toEqual({ session: s, publicKey: "key", profile: null });
  // A passing failure keeps the record for the next visit.
  store.restore.mockRejectedValue(Object.assign(new Error("offline"), { name: "RequestError" }));
  expect(await restoreSignIn()).toBeUndefined();
  expect(memory.has(KEY)).toBe(true);
  expect(store.remove).not.toHaveBeenCalled();
  // A revoked or expired grant is forgotten.
  store.restore.mockRejectedValue(
    Object.assign(new Error("gone"), { name: "AuthenticationError" }),
  );
  expect(await restoreSignIn()).toBeUndefined();
  expect(memory.has(KEY)).toBe(false);
  expect(store.remove).toHaveBeenCalledWith("stored-1");
  expect(store.free).toHaveBeenCalledTimes(4);
});

it("keeps each Session the element hands over, unless the page turns it away", async () => {
  const element = new EventTarget();
  const show = vi.fn<(value: SignedIn) => boolean>(() => true);
  onSignIn(element as never, show);
  const first = signedIn();
  element.dispatchEvent(new CustomEvent("passport-session", { detail: first }));
  expect(show).toHaveBeenCalledExactlyOnceWith(first);
  await vi.waitFor(() => expect(memory.has(KEY)).toBe(true));
  expect(store.save).toHaveBeenCalledExactlyOnceWith(first.session);
  show.mockReturnValue(false);
  element.dispatchEvent(new CustomEvent("passport-session", { detail: signedIn() }));
  await Promise.resolve();
  expect(store.save).toHaveBeenCalledOnce();
});

it("signs out: revokes, frees, forgets the saved Session and gives each button back", async () => {
  memory.set(KEY, JSON.stringify({ id: "stored-1", publicKey: "key", profile: null }));
  const s = session();
  s.signout.mockRejectedValue(new Error("offline"));
  const buttons = [{ reset: vi.fn() }, { reset: vi.fn() }];
  await signOut(signedIn(s), buttons);
  expect(s.signout).toHaveBeenCalledOnce();
  expect(s.free).toHaveBeenCalledOnce();
  expect(memory.has(KEY)).toBe(false);
  expect(store.remove).toHaveBeenCalledWith("stored-1");
  expect(store.free).toHaveBeenCalledOnce();
  for (const button of buttons) expect(button.reset).toHaveBeenCalledOnce();
});
