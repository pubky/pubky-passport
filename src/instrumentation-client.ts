import "client-only";

import { AUTHORIZATION_ENTRY_PATH } from "./libs/authorization/authorizationLocationRules";
import {
  installOpenerChannel,
  takeOpenerChannel,
} from "./client/logic/authorization/opener/OpenerChannel";
import {
  forwardHomeAuthorizationRequest,
  invalidateAuthorizationEntry,
  leaveEmptyAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  scrubAuthorizationLocation,
  type AuthorizationEntry,
} from "./client/logic/authorization/entry/authorizationEntry";
import { readAndScrubProfileEntry } from "./client/logic/authorization/entry/profileEntry";
import {
  isGoogleRedirectReturn,
  resumeGoogleRedirect,
  setGoogleRedirectRequest,
} from "./client/logic/google-identity/gia/googleRedirectBootstrap";

// Next.js runs this module's top-level code before React hydration. Unlike server
// instrumentation.ts, client instrumentation has no register() hook.
let initialProfileEntry: string | undefined;
let initialAuthorizationEntry = captureInitialAuthorizationEntry();

/**
 * Only the entry path accepts a request; `/` forwards one there instead of reading it, and an entry
 * without one leaves for `/`. The parser-time script normally did both already. One request may
 * come back on `/`: the one that left for Google in this window because the browser blocked
 * Google's pop-up (Google returns to the origin root), resumed for the rest of that Google sign-in
 * only; it returns to the entry path for its review.
 */
function captureInitialAuthorizationEntry(): AuthorizationEntry | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.pathname === AUTHORIZATION_ENTRY_PATH) {
    const entry = readAndScrubAuthorizationEntry(window);
    if (entry.status === "empty") leaveEmptyAuthorizationEntry(window);
    else {
      installOpenerChannel(window, entry);
      // A request entering here supersedes a Google round trip left behind in this tab.
      setGoogleRedirectRequest(entry, window);
    }
    return entry;
  }
  if (window.location.pathname === "/" && !forwardHomeAuthorizationRequest(window)) {
    const resumed = resumeGoogleRedirect(window);
    if (resumed) {
      // The app that opened this window keeps asking after its request (a hello every few
      // seconds). The page holds that request again, so it answers for it; `empty` would tell
      // the app its request was lost in the middle of the Google sign-in.
      installOpenerChannel(window, resumed);
      return resumed;
    }
    // `/#profile=<key>`: an app reopens Passport to finish that identity's profile.
    initialProfileEntry = readAndScrubProfileEntry(window);
    installOpenerChannel(window, { status: "empty" }, initialProfileEntry);
  }
  return undefined;
}

/** Takes the one-shot `/#profile=<key>` entry read before hydration. */
export function takeInitialProfileEntry(): string | undefined {
  const key = initialProfileEntry;
  initialProfileEntry = undefined;
  return key;
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
    // Back from Google, the address bar Next may restore carries Google's tokens instead.
    (window.location.pathname === AUTHORIZATION_ENTRY_PATH || isGoogleRedirectReturn()) &&
    (window.location.search !== "" || window.location.hash !== "")
  ) {
    // Next may restore the initial address-bar URL during hydration.
    if (!scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true })) {
      const invalid = invalidateAuthorizationEntry(entry);
      takeOpenerChannel()?.updateRequestState(invalid);
      return invalid;
    }
  }
  return entry;
}
