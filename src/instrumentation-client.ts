import "client-only";

import {
  invalidateAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
  type AuthorizationEntry,
} from "./client/logic/authorization/entry/authorizationEntry";

// Next.js runs this module's top-level code before React hydration. Unlike server
// instrumentation.ts, client instrumentation has no register() hook.
let initialAuthorizationEntry =
  typeof window !== "undefined" && window.location.pathname === "/authorize"
    ? readAndScrubAuthorizationEntry(window)
    : undefined;

/** Takes the one-shot authorization entry captured before React hydration. */
export function takeInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  const entry = initialAuthorizationEntry;
  initialAuthorizationEntry = undefined;
  if (
    entry &&
    window.location.pathname === "/authorize" &&
    (window.location.search !== "" || window.location.hash !== "")
  ) {
    // Next may restore the initial address-bar URL during hydration.
    if (!scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true })) {
      return invalidateAuthorizationEntry(entry);
    }
  }
  return entry;
}
