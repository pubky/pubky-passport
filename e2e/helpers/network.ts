import type { Page } from "@playwright/test";

/**
 * Matches every HTTPS request, for specs that must stay off the network. The glob "https://**"
 * does not: Playwright resolves it like a URL, which appends a "/" path, so it matches only URLs
 * ending in "/" and lets relay and homeserver requests reach the real network.
 */
export const ANY_HTTPS_URL = /^https:\/\//u;

/** The PKARR relays the browser SDK resolves and publishes homeserver records through. */
export const PKARR_RELAY_HOSTS: ReadonlySet<string> = new Set([
  "pkarr.pubky.app",
  "pkarr.pubky.org",
]);

/**
 * Leaves every HTTPS request unanswered, so a flow that has started stays visibly in progress
 * without reaching the network.
 */
export async function holdHttpsRequests(page: Page): Promise<void> {
  await page.route(ANY_HTTPS_URL, () => undefined);
}
