import { AUTHORIZATION_CAPTURE_MAX_CHARACTERS } from "@/libs/passportPolicy";
import {
  GOOGLE_CREDENTIAL_FRAGMENT_SOURCE,
  REQUEST_MARKER_SOURCE,
} from "./authorizationLocationRules";

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
  if (!opener) return;
  const response = mixed
    ? { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "invalid" }
    : hash.length > ${EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS}
      ? { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "too_large" }
      : { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "captured", hash };
  opener.postMessage(response, location.origin);
})();`;
