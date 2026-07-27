import { defineConfig, devices } from "@playwright/test";

const port = 3_100;
const baseURL = `http://127.0.0.1:${port}`;

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
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm start --port ${port}`,
    env: {
      GOOGLE_CLIENT_ID: "e2e-google-client-id",
      HOMEGATE_URL: "https://homegate.example/",
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
