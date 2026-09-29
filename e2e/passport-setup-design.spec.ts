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
    await page.getByRole("button", { name: "Keep key in this browser" }).click();
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
    await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep key in this browser" }).click();
    await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
    await expect(page.getByLabel("Signing in to example.app")).toHaveCount(1);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain("correct horse battery");
    expect(storage).not.toContain("kqnceEMgrNQM");
    await page.reload();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByRole("button", { name: "Keep key in this browser" }).click();
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
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
});

test("removing a browser-only key without a backup requires acknowledging one", async ({
  page,
}) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(
    page.getByText("This key is saved only in this browser.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Manage identity" }).click();
  // The screen's leave action lives in the shared page header, not in the screen content. With
  // no backup, leaving deletes the only copy, so it is named a removal rather than a logout.
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Remove key from this browser" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Remove this key from this browser?" }),
  ).toBeVisible();
  const warning = page.getByRole("main").locator('[data-tone="warning"]');
  await expect(warning).toContainText("Passport has no backup of this key.");
  await expect(warning.getByRole("button", { name: "Download backup" })).toBeVisible();
  const remove = page.getByRole("main").getByRole("button", { name: "Remove key" });
  await expect(remove).toBeDisabled();
  await page.getByRole("checkbox", { name: /I have a backup of this key/ }).check();
  await remove.click();

  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.includes("/local-identities/v1/identity/")),
    ),
  ).toEqual([]);
});

test("a backup made to remove a key only counts once its file has opened", async ({ page }) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Remove key from this browser" })
    .click();
  await page
    .getByRole("main")
    .locator('[data-tone="warning"]')
    .getByRole("button", { name: "Download backup" })
    .click();

  await page.getByLabel("Enter strong password").fill("correct horse");
  await page.getByLabel("Confirm password").fill("correct horse");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const backup = await downloadPromise;
  await expect(page.getByRole("heading", { name: "Verify backup." })).toBeVisible();
  // The removal deletes the key next, so the file has to open: there is no skip.
  await expect(page.getByRole("button", { name: /Skip this check/u })).toHaveCount(0);
  await page.getByLabel("Backup file").setInputFiles((await backup.path())!);
  await page.getByLabel("Backup password").fill("correct horse");
  await page.getByRole("button", { name: "Verify backup" }).click();

  // Back on the confirmation, which now knows the file opens: leaving is a logout again.
  await expect(page.getByRole("heading", { name: "Log out of this identity?" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("You checked a backup file of this key on");
  await expect(page.getByRole("main").locator('[data-tone="warning"]')).toHaveCount(0);
  const logOut = page.getByRole("main").getByRole("button", { name: "Log out" });
  await expect(logOut).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "I still have the backup file and know its password." })
    .check();
  await expect(logOut).toBeEnabled();
});

test("leaving the backup a removal asked for without checking it keeps the removal", async ({
  page,
}) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Remove key from this browser" })
    .click();
  await page
    .getByRole("main")
    .locator('[data-tone="warning"]')
    .getByRole("button", { name: "Download backup" })
    .click();

  await page.getByLabel("Enter strong password").fill("correct horse");
  await page.getByLabel("Confirm password").fill("correct horse");
  // The browser cancels the download: Passport made a file, but none was saved.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  await (await downloadPromise).cancel();
  await expect(page.getByRole("heading", { name: "Verify backup." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Encrypted backup." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Back is no way around the check: the key is still one removal away from being lost.
  await expect(
    page.getByRole("heading", { name: "Remove this key from this browser?" }),
  ).toBeVisible();
  const warning = page.getByRole("main").locator('[data-tone="warning"]');
  await expect(warning).toContainText("Passport made a backup file on");
  await expect(warning).toContainText("but it was never checked.");
  await expect(warning).not.toContainText("You created");
  await expect(warning.getByRole("button", { name: "Check backup" })).toBeVisible();
  await expect(warning.getByRole("button", { name: "Download backup" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Remove key" })).toBeDisabled();
  await expect(page.getByRole("main").getByRole("button", { name: "Log out" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Manage agrees, and still names leaving a removal.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("region", { name: "Backup & key access" })).toContainText(
    "but it was never checked.",
  );
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Remove key from this browser" }),
  ).toBeVisible();
});

test("the Ring export shows its private-key QR code only on request, behind a warning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Use in Pubky Ring" }).click();

  await expect(page.getByRole("heading", { name: "Use in Pubky Ring." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "This code contains your private key. Anyone who scans it can use your pubky.",
  );
  const qrCode = page.getByRole("img", { name: "Pubky Ring migration QR code" });
  await expect(qrCode).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Show QR code" }).click();
  await expect(qrCode).toBeVisible();
  await page.getByRole("button", { name: "Hide QR code" }).click();
  await expect(qrCode).toHaveCount(0);
});
