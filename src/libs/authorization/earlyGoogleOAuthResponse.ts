export const EARLY_GOOGLE_OAUTH_RESPONSE_MAX_CHARACTERS = 32_768;
export const GOOGLE_OAUTH_CALLBACK_PATH = "/google-oauth-callback";
export const GOOGLE_OAUTH_RESPONSE_MESSAGE_TYPE = "pubky-passport-google-oauth-response";

export const EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT = `(() => {
  if (location.pathname !== "${GOOGLE_OAUTH_CALLBACK_PATH}") return;
  const hash = location.hash;
  try {
    History.prototype.replaceState.call(history, null, "", location.pathname);
  } catch {
    return;
  }
  if (!opener) return;
  const response = hash.length > ${EARLY_GOOGLE_OAUTH_RESPONSE_MAX_CHARACTERS}
    ? { type: "${GOOGLE_OAUTH_RESPONSE_MESSAGE_TYPE}", status: "too_large" }
    : { type: "${GOOGLE_OAUTH_RESPONSE_MESSAGE_TYPE}", status: "captured", hash };
  opener.postMessage(response, location.origin);
})();`;
