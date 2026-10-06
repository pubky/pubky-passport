import { defineConfig, devices } from "@playwright/test";

import {
  E2E_HTTP_RELAY_URL,
  E2E_PORT,
  E2E_SIGNUP_HOMESERVER,
  INVITE_ONLY_PROVIDER,
  TESTNET,
  USE_DEV_SERVER,
} from "./e2e/helpers/e2eServer";

const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const INVITE_ONLY_PORT = E2E_PORT + 1;
const INVITE_ONLY_SPEC = /invite-only\.spec\.ts$/u;
const TESTNET_PORT = E2E_PORT + 2;
const TESTNET_SPEC = /testnet\.spec\.ts$/u;
/** Specs that run only against their own instance. */
const OWN_INSTANCE_SPECS = [INVITE_ONLY_SPEC, TESTNET_SPEC];
/** `next dev` allows one server per project, so dev mode skips the invite-only instance. */
const RUN_INVITE_ONLY = !USE_DEV_SERVER;

/**
 * Every variable `src/server/environment.ts` reads, blank meaning unset. Playwright passes the shell
 * environment through and Next.js loads `.env*` files only for variables still undefined, so pinning
 * each one keeps ambient configuration from changing the instance a project tests.
 */
const PASSPORT_ENVIRONMENT = {
  GOOGLE_CLIENT_ID: "",
  HOMEGATE_URL: "",
  PASSPORT_PROVIDER_CONFIG_JSON: "",
  PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: "",
  PASSPORT_SERVER_SECRET_KEYRING_JSON: "",
  PUBKY_SIGNUP_HOMESERVER: "",
  PUBKY_HTTP_RELAY_URL: "",
  PUBKY_NETWORK: "",
  PUBKY_TESTNET_PKARR_RELAYS: "",
  PUBKY_TESTNET_HTTP_RELAY: "",
  PUBKY_TESTNET_URL_REWRITES_JSON: "",
};

function passportServer(
  port: number,
  env: Partial<Record<keyof typeof PASSPORT_ENVIRONMENT, string>>,
) {
  return {
    command: `pnpm ${USE_DEV_SERVER ? "dev" : "start"} --hostname 127.0.0.1 --port ${port}`,
    env: { ...PASSPORT_ENVIRONMENT, ...env },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  };
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: OWN_INSTANCE_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: OWN_INSTANCE_SPECS,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: OWN_INSTANCE_SPECS,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium",
      testIgnore: OWN_INSTANCE_SPECS,
      use: { ...devices["Pixel 7"] },
    },
    ...(RUN_INVITE_ONLY
      ? [
          {
            name: "invite-only",
            testMatch: INVITE_ONLY_SPEC,
            use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${INVITE_ONLY_PORT}` },
          },
          {
            name: "testnet",
            testMatch: TESTNET_SPEC,
            use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${TESTNET_PORT}` },
          },
        ]
      : []),
  ],
  webServer: [
    passportServer(E2E_PORT, {
      GOOGLE_CLIENT_ID: "e2e-google-client-id",
      HOMEGATE_URL: "https://homegate.example/",
      PUBKY_HTTP_RELAY_URL: E2E_HTTP_RELAY_URL,
      PUBKY_SIGNUP_HOMESERVER: E2E_SIGNUP_HOMESERVER,
      PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: "e2e",
      PASSPORT_SERVER_SECRET_KEYRING_JSON: JSON.stringify({
        e2e: Buffer.alloc(32, 1).toString("base64"),
      }),
    }),
    // A self-hosted provider without Google, Homegate or a server keyring.
    ...(RUN_INVITE_ONLY
      ? [
          passportServer(INVITE_ONLY_PORT, {
            PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({
              googleEnabled: false,
              verificationMethods: ["invite"],
            }),
            PUBKY_SIGNUP_HOMESERVER: INVITE_ONLY_PROVIDER.homeserver,
          }),
          // An invite-only instance on a Pubky testnet.
          passportServer(TESTNET_PORT, {
            PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({
              googleEnabled: false,
              verificationMethods: ["invite"],
            }),
            PUBKY_NETWORK: "testnet",
            PUBKY_TESTNET_PKARR_RELAYS: TESTNET.pkarrRelay,
            PUBKY_TESTNET_HTTP_RELAY: TESTNET.httpRelay,
            PUBKY_TESTNET_URL_REWRITES_JSON: JSON.stringify(TESTNET.rewrites),
          }),
        ]
      : []),
  ],
});
