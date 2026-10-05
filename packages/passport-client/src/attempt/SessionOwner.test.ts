import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Session } from "@synonymdev/pubky";
import { FakeSession } from "../../test/FakeSession.js";
import { SessionOwner } from "./SessionOwner.js";

let sessions: FakeSession[];
beforeEach(() => {
  sessions = [];
  vi.useFakeTimers();
});
afterEach(() => {
  for (const session of sessions) session.assertFreed();
  vi.useRealTimers();
});
const fake = (outcome?: (call: number) => Promise<void>) => {
  const session = new FakeSession(outcome);
  sessions.push(session);
  return session;
};
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rejection = () => Promise.reject(new Error("pubkyauth://" + "private-revoke-canary"));

test("registers distinct handles and transfers each once without freeing app-owned Sessions", async () => {
  const owner = new SessionOwner(pause);
  const first = fake();
  const second = fake();
  const one = owner.register(first.session)!;
  const two = owner.register(second.session)!;
  expect(one).not.toBe(two);
  expect(owner.take(one)).toBe(first.session);
  expect(owner.take(one)).toBeUndefined();
  await owner.revoke(one);
  expect(first.signouts).toBe(0);
  expect(first.frees).toBe(0);
  expect(owner.take(two)).toBe(second.session);
  await owner.dispose();
  expect(second.signouts).toBe(0);
  expect(second.frees).toBe(0);
  first.session.free();
  second.session.free();
});

test("repeated registration never reacquires an owned or transferred handle", async () => {
  const owner = new SessionOwner(pause);
  const sdk = fake();
  const id = owner.register(sdk.session)!;
  expect(owner.register(sdk.session)).toBeUndefined();
  expect(owner.take(id)).toBe(sdk.session);
  expect(owner.register(sdk.session)).toBeUndefined();
  await owner.dispose();
  expect(sdk.signouts).toBe(0);
  sdk.session.free();
});

test("revokes once, excludes transfer immediately and frees after signout settles", async () => {
  let complete!: () => void;
  const sdk = fake(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const owner = new SessionOwner(pause);
  const id = owner.register(sdk.session)!;
  const first = owner.revoke(id);
  const second = owner.revoke(id);
  expect(owner.take(id)).toBeUndefined();
  await vi.advanceTimersByTimeAsync(0);
  expect(sdk.signouts).toBe(1);
  expect(sdk.frees).toBe(0);
  complete();
  await Promise.all([first, second]);
  expect(sdk.frees).toBe(1);
  await owner.revoke(id);
  expect(sdk.signouts).toBe(1);
});

test("a failed signout retries only after two seconds, then frees on success", async () => {
  const sdk = fake((call) => (call === 1 ? rejection() : Promise.resolve()));
  const diagnostics = vi.fn();
  const owner = new SessionOwner(pause, diagnostics);
  const pending = owner.revoke(owner.register(sdk.session)!);
  await vi.advanceTimersByTimeAsync(1999);
  expect(sdk.signouts).toBe(1);
  expect(sdk.frees).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(sdk.signouts).toBe(2);
  expect(sdk.frees).toBe(1);
  expect(diagnostics).not.toHaveBeenCalled();
});

test("two failed signouts emit only a fixed diagnostic and always free", async () => {
  const sdk = fake(rejection);
  const diagnostics = vi.fn();
  const owner = new SessionOwner(pause, diagnostics);
  const pending = owner.revoke(owner.register(sdk.session)!);
  await vi.advanceTimersByTimeAsync(2000);
  await expect(pending).resolves.toBeUndefined();
  expect(sdk.signouts).toBe(2);
  expect(sdk.frees).toBe(1);
  expect(diagnostics.mock.calls).toEqual([[{ code: "revoke_failed" }]]);
  expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("private-revoke-canary");
});

test.each(["sync", "async"] as const)(
  "a %s throwing diagnostic callback cannot reject cleanup",
  async (kind) => {
    const sdk = fake(rejection);
    const owner = new SessionOwner(
      pause,
      kind === "sync"
        ? () => {
            throw new Error("callback");
          }
        : async () => {
            throw new Error("callback");
          },
    );
    const pending = owner.revoke(owner.register(sdk.session)!);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeUndefined();
    expect(sdk.frees).toBe(1);
  },
);

test("dispose joins in-flight revocation and cleans newly arriving owned handles", async () => {
  const first = fake((call) => (call === 1 ? rejection() : Promise.resolve()));
  const late = fake();
  const owner = new SessionOwner(pause);
  const id = owner.register(first.session)!;
  const revoking = owner.revoke(id);
  const disposed = owner.dispose();
  const lateId = owner.register(late.session)!;
  expect(owner.take(lateId)).toBeUndefined();
  await vi.advanceTimersByTimeAsync(2000);
  await Promise.all([revoking, disposed, owner.revoke(lateId)]);
  expect(first.signouts).toBe(2);
  expect(first.frees).toBe(1);
  expect(late.signouts).toBe(1);
  expect(late.frees).toBe(1);
  await owner.dispose();
  expect(first.frees).toBe(1);
  expect(late.frees).toBe(1);
});

test("a failed retry scheduler still contains the failure, diagnoses and frees", async () => {
  const sdk = fake(rejection);
  const diagnostics = vi.fn();
  const owner = new SessionOwner(() => {
    throw new Error("clock");
  }, diagnostics);
  await expect(owner.revoke(owner.register(sdk.session)!)).resolves.toBeUndefined();
  expect(sdk.signouts).toBe(1);
  expect(sdk.frees).toBe(1);
  expect(diagnostics).toHaveBeenCalledWith({ code: "revoke_failed" });
});

test("a throwing SDK free is attempted once and never rejects the caller", async () => {
  const free = vi.fn(() => {
    throw new Error("free");
  });
  const session = { signout: vi.fn(async () => {}), free } as unknown as Session;
  const owner = new SessionOwner(pause);
  const id = owner.register(session)!;
  await expect(owner.revoke(id)).resolves.toBeUndefined();
  await owner.dispose();
  await owner.revoke(id);
  expect(free).toHaveBeenCalledTimes(1);
});

test("an SDK signout cannot re-enter transfer before revocation is marked", async () => {
  const owner = new SessionOwner(pause);
  let transferred: Session | undefined;
  const sdk = fake(() => {
    transferred = owner.take(id);
    return Promise.resolve();
  });
  const id = owner.register(sdk.session)!;
  await owner.revoke(id);
  expect(transferred).toBeUndefined();
  expect(sdk.frees).toBe(1);
});
