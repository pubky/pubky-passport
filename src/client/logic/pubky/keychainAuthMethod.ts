import "client-only";

/**
 * How Passport's own keychain requests (its profile connection and its backup check) ask Pubky
 * Ring: `grant`, the default, which Pubky Ring 2.0 and Bitkit approve, or `cookie`, the legacy
 * sign-in that Pubky Ring older than 2.0 still needs (Bitkit refuses it). A per-device choice, kept
 * in this browser; an app's own request is never rebuilt, whatever this says.
 */
export type KeychainAuthMethod = "grant" | "cookie";

export const KEYCHAIN_AUTH_METHOD_KEY = "pubky-passport/keychain-auth/v1";

const listeners = new Set<() => void>();
/** A choice made on this page, which outlives storage that would not keep it. */
let pageChoice: KeychainAuthMethod | undefined;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The method this device chose; `grant` when nothing (or nothing readable) is stored. */
export function readKeychainAuthMethod(): KeychainAuthMethod {
  try {
    return storage()?.getItem(KEYCHAIN_AUTH_METHOD_KEY) === "cookie" ? "cookie" : "grant";
  } catch {
    return "grant";
  }
}

/**
 * Keeps `method` for this device. Storage that refuses it changes nothing stored, but the
 * choice still holds for this page.
 */
export function writeKeychainAuthMethod(method: KeychainAuthMethod): void {
  pageChoice = method;
  try {
    if (method === "cookie") storage()?.setItem(KEYCHAIN_AUTH_METHOD_KEY, "cookie");
    else storage()?.removeItem(KEYCHAIN_AUTH_METHOD_KEY);
  } catch {
    // The page keeps the choice; the next visit starts from the stored one.
  }
  for (const listener of listeners) listener();
}

/** The method in force: this page's choice, else the stored one. */
export function currentKeychainAuthMethod(): KeychainAuthMethod {
  return pageChoice ?? readKeychainAuthMethod();
}

/** Calls `listener` when the choice changes here or in another tab of this origin. */
export function subscribeKeychainAuthMethod(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEYCHAIN_AUTH_METHOD_KEY && event.key !== null) return;
    pageChoice = undefined;
    listener();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}
