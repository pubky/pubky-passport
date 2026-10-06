import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/passportTest";
import { emulateCoarsePointer } from "./helpers/pointer";
import { mockPublicProfile, seedProfileIdentity } from "./helpers/pubkyProfile";
import { UNVERIFIED_BAND } from "./helpers/requester";

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
    await inspect("start-page");
    await page.getByRole("button", { name: "Enter invite manually" }).click();
    await inspect("invite-entry");
    await expect(page.getByRole("navigation", { name: "Account setup progress" })).toBeVisible();
    await page.getByLabel("Enter invite code", { exact: true }).fill("AB12-CD34-EF56");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await inspect("signer-choice");
    await page.getByRole("button", { name: "Keep key in this browser" }).click();
    await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
    await inspect("protect-key");
    await page.getByLabel("Enter strong password", { exact: true }).fill("correct horse battery");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download recovery file" }).click();
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
    await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toHaveCount(1);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain("correct horse battery");
    expect(storage).not.toContain("kqnceEMgrNQM");
    await page.reload();
    // Picking a way to verify reopens the setup saved before the reload.
    await page.getByRole("button", { name: "Enter invite manually" }).click();
    await page.getByRole("button", { name: "Keep key in this browser" }).click();
    await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
    await expect(page.getByLabel("Enter strong password", { exact: true })).toBeEmpty();

    async function inspect(name: string) {
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toHaveCount(1);
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
  await page.getByRole("button", { name: "Import it", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import recovery file." })).toBeVisible();
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
  // The one leave action sits last in the key card, with the backups it depends on, and the
  // profile card keeps only the profile's own action. With no backup, leaving deletes the only
  // copy, so the confirmation names the key.
  await expect(
    page
      .getByRole("region", { name: "Public profile" })
      .getByRole("button", { name: /Remove|Log out/u }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Public profile" })
      .getByRole("button", { name: /^(?:Set up|Edit) profile$/u }),
  ).toBeVisible();
  const keyCard = page.getByRole("region", { name: "Backup & key access" });
  // The key card's order: Back up (Pubky Ring and the recovery file), Verify, the Google
  // account, then removing, set apart at the end.
  const buttons = await keyCard.getByRole("button").allTextContents();
  expect(buttons.slice(0, 3)).toEqual([
    expect.stringContaining("Migrate to Pubky Ring"),
    expect.stringContaining("Download recovery file"),
    expect.stringContaining("Verify backup"),
  ]);
  expect(buttons.at(-1)).toContain("Remove from this browser");
  await expect(keyCard.getByRole("region", { name: "Back up" })).toBeVisible();
  await expect(keyCard.getByRole("region", { name: "Verify" })).toContainText("Never verified");
  // Both ways to back up are plain grey buttons, without an outline, like Verify backup.
  const borderColor = (name: string) =>
    keyCard
      .getByRole("button", { name, exact: true })
      .evaluate((button) => getComputedStyle(button).borderTopColor);
  expect(await borderColor("Migrate to Pubky Ring")).toBe("rgba(0, 0, 0, 0)");
  expect(await borderColor("Verify backup")).toBe("rgba(0, 0, 0, 0)");
  await keyCard.getByRole("button", { name: "Remove from this browser" }).click();

  await expect(
    page.getByRole("heading", { name: "Remove this key from this browser?" }),
  ).toBeVisible();
  const warning = page.getByRole("main").locator('[data-tone="warning"]');
  await expect(warning).toContainText("Passport has no backup of this key.");
  await expect(warning.getByRole("button", { name: "Download recovery file" })).toBeVisible();
  const remove = page.getByRole("main").getByRole("button", { name: "Remove from this browser" });
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
    .getByRole("region", { name: "Backup & key access" })
    .getByRole("button", { name: "Remove from this browser" })
    .click();
  await page
    .getByRole("main")
    .locator('[data-tone="warning"]')
    .getByRole("button", { name: "Download recovery file" })
    .click();

  await page.getByLabel("Enter strong password").fill("correct horse");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery file" }).click();
  const backup = await downloadPromise;
  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toBeVisible();
  // The removal deletes the key next, so the file has to open: there is no skip.
  await expect(page.getByRole("button", { name: /Skip this check/u })).toHaveCount(0);
  await page.getByLabel("Recovery file", { exact: true }).setInputFiles((await backup.path())!);
  await page.getByLabel("Recovery file password").fill("correct horse");
  await page.getByRole("button", { name: "Verify recovery file" }).click();

  // Back on the confirmation, which now knows the file opens: it names the identity, not the key.
  await expect(
    page.getByRole("heading", { name: "Remove this identity from this browser?" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("You checked a recovery file of this key on");
  await expect(page.getByRole("main").locator('[data-tone="warning"]')).toHaveCount(0);
  const logOut = page.getByRole("main").getByRole("button", { name: "Remove from this browser" });
  await expect(logOut).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "I still have the recovery file and know its password." })
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
    .getByRole("region", { name: "Backup & key access" })
    .getByRole("button", { name: "Remove from this browser" })
    .click();
  await page
    .getByRole("main")
    .locator('[data-tone="warning"]')
    .getByRole("button", { name: "Download recovery file" })
    .click();

  await page.getByLabel("Enter strong password").fill("correct horse");
  // The browser cancels the download: Passport made a file, but none was saved.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery file" }).click();
  await (await downloadPromise).cancel();
  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make a recovery file." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Back is no way around the check: the key is still one removal away from being lost.
  await expect(
    page.getByRole("heading", { name: "Remove this key from this browser?" }),
  ).toBeVisible();
  const warning = page.getByRole("main").locator('[data-tone="warning"]');
  await expect(warning).toContainText("Passport made a recovery file on");
  await expect(warning).toContainText("but it was never checked.");
  await expect(warning).not.toContainText("You created");
  await expect(warning.getByRole("button", { name: "Check recovery file" })).toBeVisible();
  await expect(warning.getByRole("button", { name: "Download recovery file" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Remove this key from this browser?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("button", { name: "Remove from this browser" }),
  ).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Manage agrees, and offers the same action in the key card.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("region", { name: "Backup & key access" })).toContainText(
    "but it was never checked.",
  );
  await expect(
    page
      .getByRole("region", { name: "Backup & key access" })
      .getByRole("button", { name: "Remove from this browser" }),
  ).toBeVisible();
});

test("the Ring export shows its private-key QR code only on request, behind a warning", async ({
  page,
}) => {
  const phone = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  test.skip(phone, "A phone opens the key in Pubky Ring and is shown no code; see the next test.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Migrate to Pubky Ring" }).click();

  await expect(page.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "This code contains your private key. Anyone who scans it can use your pubky.",
  );
  const qrCode = page.getByRole("img", { name: "Pubky Ring migration QR code" });
  await expect(qrCode).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The square is the control: a placeholder that shows the code, then the code that hides it.
  const square = page.getByRole("button", { name: "Show QR code" });
  await expect(page.getByRole("button", { name: /QR code/u })).toHaveCount(1);
  await expect(square).toContainText("to show QR code");
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  await expect(square.getByText(coarse ? "Tap" : "Click", { exact: true })).toBeVisible();
  await expect(square.getByText(coarse ? "Click" : "Tap", { exact: true })).toBeHidden();
  await expect(square).toHaveAttribute("aria-expanded", "false");
  await square.focus();
  await page.keyboard.press("Enter");
  await expect(qrCode).toBeVisible();
  const hide = page.getByRole("button", { name: "Hide QR code" });
  await expect(hide).toBeFocused();
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press(" ");
  await expect(qrCode).toHaveCount(0);
  await expect(square).toBeFocused();
  await square.click();
  await expect(qrCode).toBeVisible();
  await hide.click();
  await expect(qrCode).toHaveCount(0);
});

test("on a phone the Ring export only opens Pubky Ring: no code, no code warning", async ({
  page,
}) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  const phone = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  test.skip(!phone, "A computer is shown the code on request; see the test above.");
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Migrate to Pubky Ring" }).click();

  await expect(page.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open in Pubky Ring" })).toBeVisible();
  await expect(page.getByRole("button", { name: /QR code/u })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Pubky Ring migration QR code" })).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("This code contains your private key");
  await expect(
    page.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("on a phone the Ring export warns about the private key and hands it over without leaving the page", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "firefox", "The phone engines are Chromium and WebKit.");
  await emulateCoarsePointer(page);
  await mockPublicProfile(page, null);
  // Counts the hand-offs to Ring by scheme only: the link itself is the private key.
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith("pubkyring://")) {
        const handoffs = window as unknown as { __ringHandoffs?: number };
        handoffs.__ringHandoffs = (handoffs.__ringHandoffs ?? 0) + 1;
      }
      click.call(this);
    };
  });
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Migrate to Pubky Ring" }).click();
  // The phone gets the same warning as the code, and that Ring must already be installed.
  await expect(page.getByRole("main")).toContainText(
    "This link contains your private key. Anyone who receives it can use your pubky, so open it only with Pubky Ring already installed on this phone.",
  );

  const before = await page.evaluate(() => {
    Object.assign(window, { __sameDocument: true });
    return { history: history.length, url: location.href };
  });
  const open = page.getByRole("button", { name: "Open in Pubky Ring" });
  await open.click();
  await expect
    .poll(() => page.evaluate(() => (window as { __ringHandoffs?: number }).__ringHandoffs))
    .toBe(1);
  await expect(open).not.toHaveAttribute("aria-busy", "true");
  // The secret never became this page's address: same document, same URL, no history entry,
  // and the link that carried it is gone again.
  expect(
    await page.evaluate(() => ({
      sameDocument: (window as { __sameDocument?: boolean }).__sameDocument === true,
      history: history.length,
      url: location.href,
      links: document.querySelectorAll('a[href^="pubkyring:"]').length,
    })),
  ).toEqual({ sameDocument: true, history: before.history, url: before.url, links: 0 });
  await expect(page.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeVisible();
});
