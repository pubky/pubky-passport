import "client-only";

import { AUTHORIZATION_ENTRY_PATH } from "./libs/authorization/authorizationLocationRules";
import {
  forwardHomeAuthorizationRequest,
  invalidateAuthorizationEntry,
  leaveEmptyAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
  type AuthorizationEntry,
} from "./client/logic/authorization/entry/authorizationEntry";

// Next.js runs this module's top-level code before React hydration. Unlike server
// instrumentation.ts, client instrumentation has no register() hook.
let initialAuthorizationEntry = captureInitialAuthorizationEntry();

/**
 * Only the entry path accepts a request; `/` forwards one there instead of reading it, and an entry
 * without one leaves for `/`. The parser-time script normally did both already.
 */
function captureInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.pathname === AUTHORIZATION_ENTRY_PATH) {
    const entry = readAndScrubAuthorizationEntry(window);
    if (entry.status === "empty") leaveEmptyAuthorizationEntry(window);
    return entry;
  }
  if (window.location.pathname === "/") forwardHomeAuthorizationRequest(window);
  return undefined;
}

/**
 * Takes the one-shot authorization entry captured and scrubbed before React
 * hydration. Re-scrubs if Next restored the secret-bearing address bar.
 */
export function takeInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  const entry = initialAuthorizationEntry;
  initialAuthorizationEntry = undefined;
  if (
    entry &&
    window.location.pathname === AUTHORIZATION_ENTRY_PATH &&
    (window.location.search !== "" || window.location.hash !== "")
  ) {
    // Next may restore the initial address-bar URL during hydration.
    if (!scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true })) {
      return invalidateAuthorizationEntry(entry);
    }
  }
  return entry;
}
