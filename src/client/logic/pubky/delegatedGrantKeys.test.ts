import { afterEach, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { holdDelegatedKeys, whenDelegatedKeysUnused } from "./delegatedGrantKeys";

// Node provides the Web Locks API, so these tests run against a real lock manager.
afterEach(() => vi.restoreAllMocks());

it("clears only when no grant holds a delegated key", async () => {
  const clear = vi.fn(async () => undefined);
  const first = await holdDelegatedKeys();
  const second = await holdDelegatedKeys();

  expect(await whenDelegatedKeysUnused(clear)).toBe(false);
  await first();
  expect(await whenDelegatedKeysUnused(clear)).toBe(false);
  await second();
  // The release resolves after the lock manager freed it, so the clear sees no holder.
  expect(await whenDelegatedKeysUnused(clear)).toBe(true);
  expect(clear).toHaveBeenCalledOnce();
});

it("makes a new holder wait for a clear that is running", async () => {
  const events: string[] = [];
  let finishClear!: () => void;
  const clearing = whenDelegatedKeysUnused(
    () =>
      new Promise<void>((resolve) => {
        events.push("clear started");
        finishClear = () => {
          events.push("clear finished");
          resolve();
        };
      }),
  );
  await vi.waitFor(() => expect(events).toEqual(["clear started"]));
  const holding = holdDelegatedKeys().then((release) => {
    events.push("held");
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(events).toEqual(["clear started"]);
  finishClear();
  await expect(clearing).resolves.toBe(true);
  const release = await holding;
  expect(events).toEqual(["clear started", "clear finished", "held"]);
  await release();
});

it("reports a failed clear to the caller and frees the lock", async () => {
  await expect(
    whenDelegatedKeysUnused(async () => {
      throw new Error("IndexedDB unavailable");
    }),
  ).rejects.toThrow("IndexedDB unavailable");
  expect(await whenDelegatedKeysUnused(async () => undefined)).toBe(true);
});

it("never clears without Web Locks, since another tab could still use a key", async () => {
  const clear = vi.fn(async () => undefined);
  const release = await holdDelegatedKeys(undefined);
  expect(await whenDelegatedKeysUnused(clear, undefined)).toBe(false);
  expect(clear).not.toHaveBeenCalled();
  await release();
});

it("continues without a lock when the lock request fails", async () => {
  const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
  const release = await holdDelegatedKeys({
    request: () => Promise.reject(new DOMException("Document not active", "InvalidStateError")),
  });
  await release();
  expect(warning).toHaveBeenCalledWith(
    "identity.pubky.delegated_key_lock.failed",
    expect.objectContaining({ operation: "hold" }),
  );
});
