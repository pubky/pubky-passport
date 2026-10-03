/** Port of the main Passport server Playwright starts; an invite-only server uses the next one. */
export const E2E_PORT = parsePort(process.env.PASSPORT_E2E_PORT);

/**
 * `PASSPORT_E2E_DEV_SERVER=1` runs the specs against `next dev` for local debugging. Dev mode
 * relaxes the production caching headers the specs assert, so CI refuses it.
 */
export const USE_DEV_SERVER = process.env.PASSPORT_E2E_DEV_SERVER === "1";
if (USE_DEV_SERVER && process.env.CI) {
  throw new Error("PASSPORT_E2E_DEV_SERVER must not be set in CI.");
}

/**
 * `PUBKY_HTTP_RELAY_URL` of the main server: Passport's own Ring profile grants use it. Not the SDK
 * default, so the specs show the setting reaches the grant.
 */
export const E2E_HTTP_RELAY_URL = "https://relay.passport.example/inbox";

/**
 * `PUBKY_SIGNUP_HOMESERVER` of the main server. Passport has no default homeserver, so the specs
 * name one; this key has no PKARR record, so no spec reaches a real homeserver through it.
 */
export const E2E_SIGNUP_HOMESERVER = "o753nntnjs61heuf1g7i9u1zjsjo5atcx8znwkxbhinpe7pzmj4y";

/** The self-hosted provider the invite-only server runs as. */
export const INVITE_ONLY_PROVIDER = {
  homeserver: "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy",
};

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3_100;
  const port = /^\d{1,5}$/u.test(value) ? Number(value) : Number.NaN;
  if (!(port >= 1_024 && port <= 65_534)) {
    throw new Error("PASSPORT_E2E_PORT must be an integer from 1024 to 65534.");
  }
  return port;
}
