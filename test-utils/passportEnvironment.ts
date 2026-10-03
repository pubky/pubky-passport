import { vi } from "vitest";

/** Every variable `src/server/environment.ts` reads, set to a valid Google and Homegate instance. */
const PASSPORT_ENVIRONMENT = {
  PASSPORT_PROVIDER_CONFIG_JSON: undefined,
  GOOGLE_CLIENT_ID: "google-client-id",
  HOMEGATE_URL: "https://homegate.example",
  PUBKY_SIGNUP_HOMESERVER: undefined,
  PUBKY_HTTP_RELAY_URL: undefined,
  PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: "current",
  PASSPORT_SERVER_SECRET_KEYRING_JSON: JSON.stringify({
    current: Buffer.alloc(32, 1).toString("base64"),
  }),
};

export type PassportEnvironmentVariable = keyof typeof PASSPORT_ENVIRONMENT;

/**
 * Stubs every Passport variable so a test never depends on the shell or CI environment.
 * `undefined` removes a variable. Restore with `vi.unstubAllEnvs()`.
 */
export function stubPassportEnvironment(
  overrides: Partial<Record<PassportEnvironmentVariable, string | undefined>> = {},
): void {
  for (const [name, value] of Object.entries({ ...PASSPORT_ENVIRONMENT, ...overrides })) {
    vi.stubEnv(name, value);
  }
}
