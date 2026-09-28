import "client-only";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";

/**
 * Web Lock that each Passport tab holds in shared mode while one of its grant flows or sessions
 * may still sign with a browser-held delegated key. The SDK reads that key from IndexedDB for every
 * signature, so the keys may be cleared only while no one holds this lock.
 */
const DELEGATED_KEY_LOCK = "pubky-passport/delegated-grant-keys";

type LockRequester = Pick<LockManager, "request">;

/** Frees a held lock; resolves once the lock manager has released it. */
export type DelegatedKeyRelease = () => Promise<void>;

function browserLocks(): LockRequester | undefined {
  try {
    return globalThis.navigator?.locks;
  } catch {
    return undefined;
  }
}

/**
 * Holds the lock in shared mode until the returned release runs. Resolves once the lock is granted,
 * so a clear already running finishes before the caller creates a new key. Without Web Locks, or
 * when the request fails, nothing is held and the release does nothing.
 */
export async function holdDelegatedKeys(
  locks: LockRequester | undefined = browserLocks(),
): Promise<DelegatedKeyRelease> {
  if (!locks) return async () => undefined;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let granted!: () => void;
  const acquired = new Promise<void>((resolve) => {
    granted = resolve;
  });
  let request: Promise<void>;
  try {
    request = locks.request(DELEGATED_KEY_LOCK, { mode: "shared" }, () => {
      granted();
      return held;
    });
    // The request settles only after release, unless it fails before the lock is granted.
    await Promise.race([acquired, request]);
  } catch (e) {
    LOGGER.warn("identity.pubky.delegated_key_lock.failed", {
      operation: "hold",
      ...safeErrorLogFields(e),
    });
    return async () => undefined;
  }
  return async () => {
    release();
    await request.catch(() => undefined);
  };
}

/**
 * Runs `clear` only when no grant flow or session in any tab of this origin holds the lock, and
 * keeps new holders waiting until it finishes. Returns whether `clear` ran; without Web Locks it
 * never runs, because a clear could then break a grant in another tab. Rejects when `clear` does.
 */
export async function whenDelegatedKeysUnused(
  clear: () => Promise<void>,
  locks: LockRequester | undefined = browserLocks(),
): Promise<boolean> {
  if (!locks) return false;
  return locks.request(
    DELEGATED_KEY_LOCK,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) return false;
      await clear();
      return true;
    },
  );
}
