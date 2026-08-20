import "client-only";

import {
  expireAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
  type AuthorizationEntry,
} from "./authorizationEntry";

let bootstrappedEntry = readInitialAuthorizationEntry();
let expirationTimer = scheduleExpiration(bootstrappedEntry);

/** Takes the one-shot authorization entry captured before React hydration. */
export function takeInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  if (expirationTimer !== undefined) {
    window.clearTimeout(expirationTimer);
    expirationTimer = undefined;
  }
  let entry = bootstrappedEntry;
  bootstrappedEntry = undefined;
  if (entry?.status === "valid" && Date.now() >= entry.expiresAt) {
    entry = expireAuthorizationEntry(entry);
  }
  if (
    entry
    && window.location.pathname === "/authorize"
    && (window.location.search !== "" || window.location.hash !== "")
  ) {
    // Next may restore the initial address-bar URL during hydration.
    scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true });
  }
  return entry;
}

function scheduleExpiration(entry: AuthorizationEntry | undefined): number | undefined {
  if (entry?.status !== "valid") return undefined;

  const remainingLifetime = Math.max(0, entry.expiresAt - Date.now());
  if (remainingLifetime === 0) {
    bootstrappedEntry = expireAuthorizationEntry(entry);
    return undefined;
  }

  return window.setTimeout(expireBootstrappedEntry, remainingLifetime);
}

function expireBootstrappedEntry(): void {
  if (bootstrappedEntry) {
    bootstrappedEntry = expireAuthorizationEntry(bootstrappedEntry);
  }
  expirationTimer = undefined;
}

function readInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  if (typeof window === "undefined" || window.location.pathname !== "/authorize") {
    return undefined;
  }
  return readAndScrubAuthorizationEntry(window);
}
