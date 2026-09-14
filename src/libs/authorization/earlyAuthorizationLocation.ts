import { AUTHORIZATION_CAPTURE_MAX_CHARACTERS } from "@/libs/passportPolicy";

export type EarlyAuthorizationLocation =
  | { status: "captured"; hash: string; expiresAt: number }
  | { status: "expired" }
  | { status: "invalid_search" }
  | { status: "too_large" };

export const EARLY_AUTHORIZATION_LOCATION_PROPERTY = "__takePassportAuthorizationLocation";
const EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS = 60_000;

export const EARLY_AUTHORIZATION_LOCATION_SCRIPT = `(() => {
  if (location.pathname !== "/authorize") return;

  let capture;
  if (location.search !== "") {
    capture = { status: "invalid_search" };
  } else {
    const hash = location.hash;
    if (hash === "") return;
    capture = hash.length > ${AUTHORIZATION_CAPTURE_MAX_CHARACTERS}
      ? { status: "too_large" }
      : {
        status: "captured",
        hash,
        expiresAt: Date.now() + ${EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS},
      };
  }

  try {
    History.prototype.replaceState.call(history, null, "", location.pathname);
  } catch {
    try { stop(); } catch { /* Loading may already have stopped. */ }
    try { location.replace(location.pathname); } catch {
      /* Authorization-data scrubbing is best effort when native location APIs fail. */
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
