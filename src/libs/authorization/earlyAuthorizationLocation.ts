export const EARLY_AUTHORIZATION_LOCATION_PROPERTY = "__takePassportAuthorizationLocation";
export const EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS = 60_000;
export const EARLY_AUTHORIZATION_LOCATION_MAX_CHARACTERS = 32_768;

export const EARLY_AUTHORIZATION_LOCATION_SCRIPT = `(() => {
  if (location.pathname !== "/authorize") return;

  let capture;
  if (location.search !== "") {
    capture = { status: "invalid_search" };
  } else {
    const hash = location.hash;
    if (hash === "") return;
    capture = hash.length > ${EARLY_AUTHORIZATION_LOCATION_MAX_CHARACTERS}
      ? { status: "too_large" }
      : { status: "captured", hash };
  }

  try {
    History.prototype.replaceState.call(history, null, "", location.pathname);
  } catch {
    return;
  }

  let pendingCapture = capture;
  let expirationTimer;
  const clear = () => {
    pendingCapture = undefined;
    clearTimeout(expirationTimer);
    removeEventListener("pagehide", clear);
    Reflect.deleteProperty(window, "${EARLY_AUTHORIZATION_LOCATION_PROPERTY}");
  };
  expirationTimer = setTimeout(clear, ${EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS});
  addEventListener("pagehide", clear, { once: true });
  Object.defineProperty(window, "${EARLY_AUTHORIZATION_LOCATION_PROPERTY}", {
    configurable: true,
    value: () => {
      const result = pendingCapture;
      clear();
      return result;
    },
  });
})();`;

export type EarlyAuthorizationLocation =
  | { status: "captured"; hash: string }
  | { status: "invalid_search" }
  | { status: "too_large" };
