/**
 * How this client asks a keychain app (Pubky Ring or Bitkit) to approve: `grant`, the default,
 * which Pubky Ring 2.0 and Bitkit approve, or `cookie`, the legacy sign-in that Pubky Ring older
 * than 2.0 still needs (Bitkit refuses it). The person picks it with the element's "classic QR"
 * switch, or the app with `setClassicQr()`; the choice is kept for this device, in this origin's
 * own storage, and shapes every request the client makes (its QR code and Passport's pop-up).
 */
export type KeychainAuth = "grant" | "cookie";

export const KEYCHAIN_AUTH_STORAGE_KEY = "pubky-passport-client/keychain-auth/v1";

/** The stored choice; `grant` when nothing, or nothing readable, is stored. */
export function readKeychainAuth(storage: () => Storage | undefined): KeychainAuth {
  try {
    return storage()?.getItem(KEYCHAIN_AUTH_STORAGE_KEY) === "cookie" ? "cookie" : "grant";
  } catch {
    return "grant";
  }
}

/** Keeps `auth` for this device; storage that refuses it changes nothing. */
export function writeKeychainAuth(storage: () => Storage | undefined, auth: KeychainAuth): void {
  try {
    if (auth === "cookie") storage()?.setItem(KEYCHAIN_AUTH_STORAGE_KEY, "cookie");
    else storage()?.removeItem(KEYCHAIN_AUTH_STORAGE_KEY);
  } catch {
    // The caller keeps the choice for this page.
  }
}
