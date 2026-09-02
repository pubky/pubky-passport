import { AUTHORIZATION_CAPTURE_MAX_CHARACTERS } from "../passportPolicy";

export const EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS = AUTHORIZATION_CAPTURE_MAX_CHARACTERS;
export const GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE = "pubky-passport-google-implicit-response";

export const EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT = `(() => {
  if (location.pathname !== "/") return;
  const hash = location.hash;
  if (!/(?:^|&)(?:access_token|id_token|error)=/.test(hash.slice(1))) return;
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
  const response = hash.length > ${EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS}
    ? { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "too_large" }
    : { type: "${GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE}", status: "captured", hash };
  opener.postMessage(response, location.origin);
})();`;
