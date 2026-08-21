import "client-only";

import {
  invalidateAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
  type AuthorizationEntry,
} from "./authorizationEntry";

let bootstrappedEntry = readInitialAuthorizationEntry();

/** Takes the one-shot authorization entry captured before React hydration. */
export function takeInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  const entry = bootstrappedEntry;
  bootstrappedEntry = undefined;
  if (
    entry
    && window.location.pathname === "/authorize"
    && (window.location.search !== "" || window.location.hash !== "")
  ) {
    // Next may restore the initial address-bar URL during hydration.
    if (!scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true })) {
      return invalidateAuthorizationEntry(entry);
    }
  }
  return entry;
}

function readInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  if (typeof window === "undefined" || window.location.pathname !== "/authorize") {
    return undefined;
  }
  return readAndScrubAuthorizationEntry(window);
}
