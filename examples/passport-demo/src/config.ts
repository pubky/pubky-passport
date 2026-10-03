/** This app's identity. Environment variables override them for other deployments. */
export const APP_NAME = import.meta.env.VITE_APP_NAME?.trim() || "Passport Demo";
export const APP_CLIENT_ID = import.meta.env.VITE_CLIENT_ID?.trim() || "passport-demo";
/** The folder on each person's homeserver that this app reads and writes. */
export const APP_PATH = "/pub/passport-demo/" as const;
export const APP_CAPABILITIES = import.meta.env.VITE_CAPABILITIES?.trim() || `${APP_PATH}:rw`;
/** A Passport other than the package's own (https://passport.pubky.app), when one is set. */
export const PASSPORT_URL = import.meta.env.VITE_PASSPORT_URL?.trim() || undefined;
/** Prefix of this app's localStorage keys. */
export const STORAGE_NAMESPACE = import.meta.env.VITE_STORAGE_NAMESPACE?.trim() || APP_CLIENT_ID;
