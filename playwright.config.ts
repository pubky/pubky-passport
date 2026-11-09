import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3_100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** A second server with Apple login on, used by e2e/apple-*.spec.ts. */
export const APPLE_PORT = PORT + 1;
const SERVER_ENV = {
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  HOMEGATE_URL: "https://homegate.example/",
  PUBKY_HOMESERVER_CONNECT_ORIGINS: "https://homeserver.example",
  PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: "e2e",
  PASSPORT_SERVER_SECRET_KEYRING_JSON: JSON.stringify({
    e2e: Buffer.alloc(32, 1).toString("base64"),
  }),
};

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
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: `pnpm start --port ${PORT}`,
      env: SERVER_ENV,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `pnpm start --port ${APPLE_PORT}`,
      env: {
        ...SERVER_ENV,
        APPLE_LOGIN_ENABLED: "true",
        APPLE_SERVICES_ID: "app.pubky.passport.e2e",
        APPLE_CLOUDKIT_CONTAINER_ID: "iCloud.app.pubky.passport.e2e",
        APPLE_CLOUDKIT_API_TOKEN: "e2e0123456789abcdef0123456789abcd",
        APPLE_CLOUDKIT_ENVIRONMENT: "development",
      },
      url: `http://127.0.0.1:${APPLE_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
