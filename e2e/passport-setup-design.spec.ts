import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/passportTest";
import { mockPublicProfile, seedProfileIdentity } from "./helpers/pubkyProfile";

const REQUEST =
  "pubkyauth://signin?caps=/pub/app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Example%20App&x-success=https%3A%2F%2Fexample.app%2Fdone";
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
  { width: 520, height: 760 },
]) {
  test(`account and recovery screens preserve progress and request at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await inspect("verification-methods");
    await expect(page.getByRole("navigation", { name: "Account setup progress" })).toBeVisible();
    await page.getByRole("button", { name: "Enter invite manually" }).click();
    await page.getByLabel("Enter invite code", { exact: true }).fill("AB12-CD34-EF56");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await inspect("signer-choice");
    await page.getByRole("button", { name: "Keep in Passport" }).click();
    await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
    await inspect("protect-key");
    await page.getByLabel("Enter strong password", { exact: true }).fill("correct horse battery");
    await page.getByLabel("Confirm password", { exact: true }).fill("correct horse battery");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download encrypted backup" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pkarr$/);
    await inspect("verify-backup");
    // Each recovery step moves focus to its heading.
    await expect(page.locator("main h1")).toBeFocused();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Choose your signer." })).toBeVisible();
    await page.getByRole("button", { name: "Keep in Passport" }).click();
    await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
    await expect(page.getByLabel("Signing in to example.app")).toHaveCount(1);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain("correct horse battery");
    expect(storage).not.toContain("kqnceEMgrNQM");
    await page.reload();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByRole("button", { name: "Keep in Passport" }).click();
    await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
    await expect(page.getByLabel("Enter strong password", { exact: true })).toBeEmpty();

    async function inspect(name: string) {
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.getByLabel("Signing in to example.app")).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      const layout = await page.evaluate(() => ({
        main: document.querySelector("main")!.getBoundingClientRect().bottom,
        footer: document.querySelector("footer")!.getBoundingClientRect().top,
      }));
      expect(layout.footer).toBeGreaterThanOrEqual(layout.main - 1);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${viewport.width}.png`),
        fullPage: true,
      });
    }
  });
}

test("import uses a compact accessible form with a working Back action", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import backup." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("import-backup.png"), fullPage: true });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();
});

test("logging out a browser-only key requires acknowledging a backup", async ({ page }) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await page.getByRole("button", { name: "Manage identity" }).click();
  // The screen's Log out action lives in the shared page header, not in the screen content.
  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();

  await expect(page.getByRole("heading", { name: "Log out of this identity?" })).toBeVisible();
  const logOut = page.getByRole("main").getByRole("button", { name: "Log out" });
  await expect(logOut).toBeDisabled();
  await page.getByRole("checkbox", { name: /I have a backup of this identity/ }).check();
  await logOut.click();

  await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.includes("/local-identities/v1/identity/")),
    ),
  ).toEqual([]);
});
