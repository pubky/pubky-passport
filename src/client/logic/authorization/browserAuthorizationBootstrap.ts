import "client-only";

import {
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
  type AuthorizationEntry,
} from "./browserAuthorizationEntry";

let bootstrappedEntry = readInitialAuthorizationEntry();

/** Takes the one-shot authorization entry captured before React hydration. */
export function takeBootstrappedAuthorizationEntry(): AuthorizationEntry | undefined {
  const entry = bootstrappedEntry;
  bootstrappedEntry = undefined;
  if (
    entry
    && window.location.pathname === "/authorize"
    && (window.location.search !== "" || window.location.hash !== "")
  ) {
    // Next may restore the initial browser URL during hydration.
    scrubAuthorizationLocation(window, true);
  }
  return entry;
}

function readInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  if (typeof window === "undefined" || window.location.pathname !== "/authorize") {
    return undefined;
  }
  return readAndScrubAuthorizationEntry(window);
}
