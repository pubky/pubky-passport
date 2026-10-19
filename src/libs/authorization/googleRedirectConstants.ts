/** Only pending request metadata is stored here; Google credentials stay in memory. */
export const GOOGLE_REDIRECT_STORAGE_KEY = "pubky-passport/google-redirect/v1";
export const EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY = "__takePassportGoogleRedirectResponse";

/** Routing hint only; state and nonce must still match the saved attempt. */
export const GOOGLE_REDIRECT_STATE_PREFIX = "redirect.";
