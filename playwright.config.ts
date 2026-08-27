import { defineConfig, devices } from "@playwright/test";

const PORT = 3_100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "line",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    env: {
      GOOGLE_CLIENT_ID: "e2e-google-client-id",
      HOMEGATE_URL: "https://homegate.example/",
      PUBKY_HOMESERVER_CONNECT_ORIGINS: "https://homeserver.example",
      PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: "e2e",
      PASSPORT_SERVER_SECRET_KEYRING_JSON: JSON.stringify({
        e2e: Buffer.alloc(32, 1).toString("base64"),
      }),
    },
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
