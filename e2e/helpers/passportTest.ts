import { test as base } from "@playwright/test";

export { expect, type Page, type BrowserContext, type Route } from "@playwright/test";

export const test = base.extend<{ homegateAvailability: void }>({
  homegateAvailability: [
    async ({ context }, use) => {
      // Context-level routes also cover Google redirect windows and signer popups.
      await context.route("**/sms_verification/info", (route) =>
        route.fulfill({ status: 200, body: "" }),
      );
      await context.route("**/ln_verification/info", (route) =>
        route.fulfill({ json: { amountSat: 10 } }),
      );
      await context.route("**/google_verification", (route) =>
        route.request().method() === "GET"
          ? route.fulfill({ status: 405, body: "" })
          : route.fallback(),
      );
      // Invite lookups are read-only; tests that need other answers override this route.
      await context.route("**/signup_tokens/**", (route) =>
        route.fulfill({ json: { status: "valid" } }),
      );
      await use();
    },
    { auto: true },
  ],
});
