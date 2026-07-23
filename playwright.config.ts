import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm exec next start --hostname 127.0.0.1 --port 3100",
    env: {
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "playwright-client-id",
      NEXT_PUBLIC_HTTP_RELAY_URL: "https://relay.e2e.invalid/inbox",
      NEXT_PUBLIC_PASSPORT_PUBLIC_URL: "https://passport.e2e.invalid",
      PUBKY_BROWSER_CONNECT_ORIGINS: "",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100/api/health",
  },
});
