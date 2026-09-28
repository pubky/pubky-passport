import { AUTHORIZATION_CAPTURE_MAX_CHARACTERS } from "@/libs/passportPolicy";
import {
  AUTHORIZATION_ENTRY_PATH,
  FORWARDED_QUERY,
  GOOGLE_CREDENTIAL_FRAGMENT_SOURCE,
  REQUEST_MARKER_SOURCE,
  REQUEST_QUERY_SOURCE,
} from "./authorizationLocationRules";

export type EarlyAuthorizationLocation =
  | { status: "captured"; hash: string; expiresAt: number }
  | { status: "expired" }
  | { status: "invalid_search" }
  | { status: "too_large" };

export const EARLY_AUTHORIZATION_LOCATION_PROPERTY = "__takePassportAuthorizationLocation";
const EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS = 60_000;

/**
 * Runs before any app code. On `/`, a request-bearing location is forwarded to the entry path, at
 * load and on later same-document fragment navigations; a query is replaced by the valueless
 * `FORWARDED_QUERY`, never copied. On the entry path the request is captured and scrubbed; a later
 * fragment navigation there (a reused named popup) reloads so this capture runs for it. An entry
 * without a request leaves for `/`. The fragment is never copied anywhere but the entry URL itself.
 */
export const EARLY_AUTHORIZATION_LOCATION_SCRIPT = `(() => {
  const entryPath = "${AUTHORIZATION_ENTRY_PATH}";

  if (location.pathname === "/") {
    const forward = (stopLoading) => {
      if (/${GOOGLE_CREDENTIAL_FRAGMENT_SOURCE}/.test(location.hash.slice(1))) return false;
      if (!/${REQUEST_MARKER_SOURCE}/i.test(location.search + location.hash)) return false;
      const query = location.search === "" ? "" : "${FORWARDED_QUERY}";
      const destination = entryPath + query + location.hash;
      try {
        History.prototype.replaceState.call(history, null, "", "/");
      } catch { /* Replacing this history entry below removes the request as well. */ }
      if (stopLoading) {
        try { stop(); } catch { /* Loading may already have stopped. */ }
      }
      try { location.replace(destination); } catch {
        /* Forwarding is best effort when native location APIs fail. */
      }
      return true;
    };
    if (!forward(true)) addEventListener("hashchange", () => forward(false));
    return;
  }

  if (location.pathname !== entryPath) return;
  addEventListener("hashchange", () => {
    if (location.hash !== "") location.reload();
  });

  const hash = location.hash;
  let capture;
  if (location.search !== "") {
    // A plain query (analytics, referrers) carries no request and is only scrubbed;
    // a request in the query, or a query next to a fragment, is rejected.
    capture = hash !== "" || /${REQUEST_QUERY_SOURCE}/.test(location.search)
      ? { status: "invalid_search" }
      : undefined;
  } else if (hash !== "") {
    capture = hash.length > ${AUTHORIZATION_CAPTURE_MAX_CHARACTERS}
      ? { status: "too_large" }
      : {
        status: "captured",
        hash,
        expiresAt: Date.now() + ${EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS},
      };
  }

  let scrubbed = false;
  try {
    History.prototype.replaceState.call(history, null, "", location.pathname);
    scrubbed = true;
  } catch { /* Leaving below removes the request as well. */ }
  if (!scrubbed || capture === undefined) {
    // Without a request nothing is reviewed here, and identity management belongs on the home
    // page. A request that cannot be scrubbed is dropped too.
    try { stop(); } catch { /* Loading may already have stopped. */ }
    try { location.replace("/"); } catch {
      /* Leaving is best effort when native location APIs fail. */
    }
    return;
  }

  let pendingCapture = capture;
  let expired = false;
  let expirationTimer;
  const dispose = () => {
    pendingCapture = undefined;
    clearTimeout(expirationTimer);
    removeEventListener("pagehide", dispose);
    Reflect.deleteProperty(window, "${EARLY_AUTHORIZATION_LOCATION_PROPERTY}");
  };
  expirationTimer = setTimeout(() => {
    pendingCapture = undefined;
    expired = true;
  }, ${EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS});
  addEventListener("pagehide", dispose, { once: true });
  Object.defineProperty(window, "${EARLY_AUTHORIZATION_LOCATION_PROPERTY}", {
    configurable: true,
    value: () => {
      const result = pendingCapture ?? (expired ? { status: "expired" } : undefined);
      dispose();
      return result;
    },
  });
})();`;
