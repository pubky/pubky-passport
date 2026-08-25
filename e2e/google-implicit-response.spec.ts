import { expect, test } from "@playwright/test";

const ACCESS_TOKEN = "oauth-access-token-canary";
const ID_TOKEN = "oauth-id-token-canary";

test("scrubs implicit OAuth credentials before callback hydration", async ({ page }) => {
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));

  await page.goto(`/#${new URLSearchParams({
    access_token: ACCESS_TOKEN,
    id_token: ID_TOKEN,
    scope: "openid",
    state: "state-canary",
  })}`);

  await expect(page).toHaveURL(/\/$/u);
  expect(await page.evaluate(() => location.hash)).toBe("");
  const html = await page.content();
  expect(html).not.toContain(ACCESS_TOKEN);
  expect(html).not.toContain(ID_TOKEN);
  expect(JSON.stringify(consoleLines)).not.toContain(ACCESS_TOKEN);
  expect(JSON.stringify(consoleLines)).not.toContain(ID_TOKEN);
  const response = await page.request.get("/");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
});

test("scrubs a malformed ID-token fragment before callback hydration", async ({ page }) => {
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));

  await page.goto(`/#id_token=${ID_TOKEN}`);

  await expect(page).toHaveURL(/\/$/u);
  expect(await page.evaluate(() => location.hash)).toBe("");
  expect(await page.content()).not.toContain(ID_TOKEN);
  expect(JSON.stringify(consoleLines)).not.toContain(ID_TOKEN);
});
