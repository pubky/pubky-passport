import { AUTHORIZATION_CAPTURE_MAX_CHARACTERS } from "@/libs/passportPolicy";
import {
  GOOGLE_CREDENTIAL_FRAGMENT_SOURCE,
  REQUEST_MARKER_SOURCE,
} from "./authorizationLocationRules";
import {
  EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY,
  GOOGLE_REDIRECT_STORAGE_KEY,
} from "./googleRedirectConstants";

export const EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS = AUTHORIZATION_CAPTURE_MAX_CHARACTERS;
export const GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE = "pubky-passport-google-implicit-response";

export const EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT = `(() => {
  if (location.pathname !== "/") return;
  const hash = location.hash;
  if (!/${GOOGLE_CREDENTIAL_FRAGMENT_SOURCE}/.test(hash.slice(1))) return;
  const mixed = /${REQUEST_MARKER_SOURCE}/i.test(hash);
  try {
    History.prototype.replaceState.call(history, null, "", location.pathname);
  } catch {
    try { stop(); } catch { /* Loading may already have stopped. */ }
    try { location.replace(location.pathname); } catch {
      /* Credential scrubbing is best effort when both native location APIs fail. */
    }
    return;
  }
  const response = mixed
    ? { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "invalid" }
    : hash.length > ${EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS}
      ? { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "too_large" }
      : { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "captured", hash };
  let redirectPending = false;
  try { redirectPending = sessionStorage.getItem("${GOOGLE_REDIRECT_STORAGE_KEY}") !== null; } catch { /* Fail closed during bootstrap. */ }
  if (redirectPending) {
    let pending = response;
    const dispose = () => {
      pending = undefined;
      clearTimeout(timer);
      removeEventListener("pagehide", dispose);
    };
    const timer = setTimeout(dispose, 60_000);
    addEventListener("pagehide", dispose, { once: true });
    Object.defineProperty(window, "${EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY}", {
      configurable: true,
      value: () => {
        const captured = pending;
        dispose();
        Reflect.deleteProperty(window, "${EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY}");
        return captured;
      },
    });
    return;
  }
  if (!opener) return;
  opener.postMessage(response, location.origin);
})();`;
