import "client-only";

const STORAGE_KEY = "pubky-passport/authorize-from-identity";

/**
 * Authorize on an identity's overview takes a pasted or scanned request, and Passport reloads onto
 * `/authorize#d=<request>` to open it. This note carries the identity across that reload, so the
 * request opens on its review instead of asking again which identity to use. It holds a public
 * key only, lives in this tab's session storage and is read once: the next page load takes it.
 *
 * `storage` is read inside the guard: where the browser blocks site data, even naming
 * `window.sessionStorage` throws, and the request must still open (on its identity list).
 */
export function markAuthorizeFromIdentity(
  publicKeyZ32: string,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? window.sessionStorage).setItem(STORAGE_KEY, publicKeyZ32);
  } catch {
    // Without the note the request opens on the identity list, as any other request does.
  }
}

/** The identity Authorize was pressed on before this page load, if any; forgotten once read. */
export function takeAuthorizeFromIdentity(
  storage?: Pick<Storage, "getItem" | "removeItem">,
): string | undefined {
  try {
    const tabStorage = storage ?? window.sessionStorage;
    const publicKeyZ32 = tabStorage.getItem(STORAGE_KEY);
    tabStorage.removeItem(STORAGE_KEY);
    return publicKeyZ32 ?? undefined;
  } catch {
    return undefined;
  }
}
