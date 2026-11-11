import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECRET_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const STORAGE_ROOT = "pubky-passport/local-identities/v1";

async function seedLocalIdentity(page: Page) {
  await page.addInitScript(
    ({ publicKey, secretKey, storageRoot }) => {
      localStorage.setItem(
        `${storageRoot}/identity/${publicKey}`,
        JSON.stringify({ v: 1, publicKeyZ32: publicKey, secretKey }),
      );
      localStorage.setItem(`${storageRoot}/active`, publicKey);
    },
    { publicKey: PUBLIC_KEY, secretKey: SECRET_KEY, storageRoot: STORAGE_ROOT },
  );
}

test("authorized apps show a retryable error when the homeserver cannot be reached", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  // Without a resolvable homeserver the root session cannot be created.
  let lookups = 0;
  await page.route("https://pkarr.*/**", (route) => {
    lookups += 1;
    return route.fulfill({ status: 404 });
  });
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();

    const section = page.getByRole("region", { name: "Authorized apps" });
    await expect(section).toBeVisible();
    await expect(section.getByText("Could not load authorized apps.")).toBeVisible();

    expect(lookups).toBeGreaterThan(0);
    await section.getByRole("button", { name: "Try again" }).click();
    await expect(section.getByText("Could not load authorized apps.")).toBeVisible();
    await expect(section.getByRole("button", { name: "Try again" })).toBeEnabled();

    const logout = await page.getByRole("button", { name: "Log out", exact: true }).boundingBox();
    const sectionBox = await section.boundingBox();
    const back = await page.getByRole("button", { name: "Back", exact: true }).boundingBox();
    if (!logout || !sectionBox || !back) throw new Error("Management layout must be visible");
    expect(sectionBox.y).toBeGreaterThanOrEqual(logout.y + logout.height);
    expect(back.y).toBeGreaterThanOrEqual(sectionBox.y + sectionBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }

  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
  expect(consoleMessages.join("\n")).not.toContain(SECRET_KEY);
});
