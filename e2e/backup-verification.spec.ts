import { recordClipboard } from "./helpers/clipboard";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { expect, test, type Page } from "./helpers/passportTest";
import { emulateCoarsePointer } from "./helpers/pointer";
import { delegatedKeyCount, mockRingNetwork, ringApproves } from "./helpers/pubkyRing";
import { OTHER_KEY, OTHER_KEY_SEED, PROFILE_KEY } from "./helpers/pubkyProfile";
import { RECOVERY_FILE_PASSWORD, recoveryFile } from "./helpers/recoveryFile";

// Pubky Ring is played by the real SDK signer in the test process; see `helpers/pubkyRing.ts`.
// `PROFILE_KEY` is saved here with its secret key, and Ring's signer holds the same key.
const BACKUP_KEY = `pubky-passport/local-identities/v1/identity-backup/${PROFILE_KEY}`;
const GOOGLE_ACCOUNT = {
  googleSubject: "google-subject",
  name: "Carol",
  email: "carol@example.com",
  pictureUrl: null,
};
/** WebKit can take several seconds to write the SDK's IndexedDB key. */
const DELEGATED_KEY_TIMEOUT_MS = 20_000;

/** Saves `PROFILE_KEY` with its key in this browser, with `backup` beside it, and opens Passport. */
async function seedBrowserKey(
  page: Page,
  { backup, google = false }: { backup?: object; google?: boolean } = {},
) {
  await page.goto("/terms-of-service", { waitUntil: "domcontentloaded" });
  await storeLocalIdentities(
    page,
    [{ publicKeyZ32: PROFILE_KEY, ...(google ? { googleAccount: GOOGLE_ACCOUNT } : {}) }],
    { active: PROFILE_KEY },
  );
  if (backup)
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify({ v: 1, ...value })),
      { key: BACKUP_KEY, value: backup },
    );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
}

/** Manage → Verify backup: the one page with both checks. */
async function openVerifyBackup(page: Page) {
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Verify backup" }).click();
  await expect(page.getByRole("heading", { name: "Verify your backup." })).toBeVisible();
}

const fileCard = (page: Page) => page.getByRole("region", { name: "Recovery file" });
const ringCard = (page: Page) => page.getByRole("region", { name: "Pubky Ring", exact: true });

/**
 * A phone's check: the card's one press opens Pubky Ring with the request's link, read here for
 * Ring to approve. The link is found by its target, whatever its button says at the time.
 */
async function phoneVerificationRequest(page: Page): Promise<URL> {
  await ringCard(page).getByRole("button", { name: "Verify in Pubky Ring" }).click();
  const link = ringCard(page)
    .getByRole("region", { name: "Pubky Ring backup check" })
    .locator('a[href^="pubkyauth:"]');
  await expect(link).toHaveAttribute("href", /^pubkyauth:\/\//u);
  return new URL((await link.getAttribute("href"))!);
}

async function storedBackup(page: Page): Promise<Record<string, unknown> | null> {
  const value = await page.evaluate((key) => localStorage.getItem(key), BACKUP_KEY);
  return value === null ? null : (JSON.parse(value) as Record<string, unknown>);
}

test("Backup & key access lists Back up, then Verify, the Google account, and Remove set apart", async ({
  page,
}) => {
  await mockRingNetwork(page);
  await seedBrowserKey(page);
  await page.getByRole("button", { name: "Manage identity" }).click();
  const card = page.getByRole("region", { name: "Backup & key access" });
  await expect(card).toContainText("No backup yet.");

  const sections = card.getByRole("region");
  await expect(sections).toHaveText([/^Back up/u, /^Verify/u, /^Google account/u]);
  await expect(card.getByRole("region", { name: "Back up" }).getByRole("button")).toHaveText([
    /Migrate to Pubky Ring/u,
    /Download recovery file/u,
  ]);
  const verify = card.getByRole("region", { name: "Verify" });
  await expect(verify.getByRole("button")).toHaveText([/Verify backup/u]);
  await expect(verify).toContainText("Never verified");
  // Removing comes last, below a divider, after the Google account.
  const remove = card.getByRole("button", { name: "Remove from this browser" });
  const google = card.getByRole("region", { name: "Google account" });
  expect((await remove.boundingBox())!.y).toBeGreaterThan(
    (await google.boundingBox())!.y + (await google.boundingBox())!.height,
  );
  expect(
    await remove.evaluate((button) => getComputedStyle(button.parentElement!).borderTopWidth),
  ).toBe("1px");

  // Verify backup opens one page with both checks, file first, and one way back.
  await verify.getByRole("button", { name: "Verify backup" }).click();
  await expect(page.getByRole("heading", { name: "Verify your backup." })).toBeVisible();
  await expect(fileCard(page)).toContainText("Never checked");
  await expect(fileCard(page).getByLabel("Recovery file", { exact: true })).toBeVisible();
  await expect(fileCard(page).getByLabel("Recovery file password")).toBeVisible();
  await expect(ringCard(page)).toContainText("Never verified");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
});

test("Verify your backup lays its two cards out side by side on a computer, stacked on a phone", async ({
  page,
  isMobile,
}) => {
  await mockRingNetwork(page);
  // A phone's pointer is coarse; Chromium's phone emulation does not say so by itself.
  if (isMobile) await emulateCoarsePointer(page);
  else await page.setViewportSize({ width: 1280, height: 800 });
  await seedBrowserKey(page);
  await openVerifyBackup(page);
  const file = (await fileCard(page).boundingBox())!;
  const ring = (await ringCard(page).boundingBox())!;
  if (isMobile) {
    // Stacked, the recovery file first; the Ring card starts from its button, and nothing is
    // asked of Pubky Ring before it.
    expect(ring.y).toBeGreaterThanOrEqual(file.y + file.height);
    await page.waitForLoadState("networkidle");
    await expect(
      ringCard(page).getByRole("button", { name: "Verify in Pubky Ring" }),
    ).toBeVisible();
    await expect(ringCard(page).getByRole("img", { name: /QR code/u })).toHaveCount(0);
  } else {
    // Side by side, the file on the left; the Ring code is there at once, with nothing to press.
    expect(Math.abs(ring.y - file.y)).toBeLessThanOrEqual(1);
    expect(ring.x).toBeGreaterThan(file.x + file.width);
    await expect(
      ringCard(page).getByRole("img", { name: "Pubky Ring verification QR code" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(ringCard(page).getByText(/Waiting for|Preparing your/u)).toHaveCount(0);
    await expect(ringCard(page).getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(
      ringCard(page).getByRole("link", { name: "Download Pubky Ring on the App Store" }),
    ).toBeVisible();
    // A 1280x800 window shows the whole page without scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      800,
    );
  }
});

test("a passing check goes back by itself, said with a toast; a failing one stays in its card", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The phone's Ring check starts from its button; see the next test.");
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  const copied = await recordClipboard(page);
  await seedBrowserKey(page);
  await openVerifyBackup(page);
  const code = ringCard(page).getByRole("img", { name: "Pubky Ring verification QR code" });
  await expect(code).toBeVisible({ timeout: 15_000 });

  // A wrong password is said at the field, in the file card, and Pubky Ring keeps waiting.
  await fileCard(page).getByLabel("Recovery file", { exact: true }).setInputFiles(recoveryFile());
  await fileCard(page).getByLabel("Recovery file password").fill("wrong password");
  await fileCard(page).getByRole("button", { name: "Verify recovery file" }).click();
  await expect(fileCard(page).getByRole("alert")).toContainText(
    "That password doesn’t open this file.",
  );
  await expect(code).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

  // The right one: a toast, and back on Manage by itself, which names the check.
  await fileCard(page).getByLabel("Recovery file password").fill(RECOVERY_FILE_PASSWORD);
  await fileCard(page).getByRole("button", { name: "Verify recovery file" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Recovery file verified" }),
  ).toBeVisible();
  const verifyRow = page
    .getByRole("region", { name: "Backup & key access" })
    .getByRole("region", { name: "Verify" });
  await expect(verifyRow).toContainText(/Last verified .+ \(Recovery file\)/u);
  // Leaving let go of Ring's request: nothing waits on the relay with the old key.
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);

  // Pubky Ring: pressing the code copies the link it encodes; the request asks for nothing.
  await page.getByRole("button", { name: "Verify backup" }).click();
  await expect(fileCard(page)).toContainText("Last checked");
  await expect(code).toBeVisible({ timeout: 15_000 });
  await ringCard(page).getByRole("button", { name: "Copy authentication link" }).click();
  const [link] = await copied();
  const request = new URL(link!);
  expect(request.searchParams.get("caps") ?? "").toBe("");
  await ringApproves(net, request.href);
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Verified in Pubky Ring" }),
  ).toBeVisible();
  await expect(verifyRow).toContainText(/Last verified .+ \(Pubky Ring\)/u);
  expect(net.exchangedGrants).toEqual([[]]);
  expect(net.writes).toEqual([]);
  const backup = await storedBackup(page);
  expect(Object.keys(backup!).sort()).toEqual(["ringVerifiedAt", "v", "verifiedAt"]);
  await expect(page.getByRole("region", { name: "Backup & key access" })).not.toContainText(
    "No backup yet",
  );
});

test("Pubky Ring's check records the date once Ring signs with this key, and the key counts as backed up", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  await emulateCoarsePointer(page);
  await seedBrowserKey(page);
  await expect(page.getByText("This key is saved only in this browser.")).toBeVisible();
  await openVerifyBackup(page);

  // Nothing is asked of Pubky Ring before the card's button.
  expect(net.relayRequests).toEqual([]);
  const request = await phoneVerificationRequest(page);
  await expect(ringCard(page).getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(ringCard(page).getByText(/Waiting for|Preparing your/u)).toHaveCount(0);
  // The request asks for nothing at all, on Passport's own relay.
  expect(request.searchParams.get("caps") ?? "").toBe("");
  await expect.poll(() => net.relayRequests.length).toBeGreaterThan(0);
  await ringApproves(net, request.href);

  // Passed: back on Manage by itself.
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  // The approval granted nothing, nothing was written, and its key is gone from the browser.
  expect(net.exchangedGrants).toEqual([[]]);
  expect(net.writes).toEqual([]);
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);
  // Only the date is kept, beside the key's other backup dates; no token or session.
  const backup = await storedBackup(page);
  expect(Object.keys(backup!)).toEqual(["v", "ringVerifiedAt"]);
  expect(Date.now() - Date.parse(backup!.ringVerifiedAt as string)).toBeLessThan(60_000);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain("e2e-bearer");

  const card = page.getByRole("region", { name: "Backup & key access" });
  await expect(card.getByRole("region", { name: "Verify" })).toContainText(
    /Last verified .+ \(Pubky Ring\)/u,
  );
  await expect(card).not.toContainText("No backup yet");

  // A copy Pubky Ring signed with counts like a checked file: removing names the identity, not
  // the key, and its owner confirms Ring still has it.
  await card.getByRole("button", { name: "Remove from this browser" }).click();
  await expect(
    page.getByRole("heading", { name: "Remove this identity from this browser?" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Pubky Ring signed in with this key on");
  const remove = page.getByRole("main").getByRole("button", { name: "Remove from this browser" });
  await expect(remove).toBeDisabled();
  await page.getByRole("checkbox", { name: "This key is still in my Pubky Ring." }).check();
  await expect(remove).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  // The overview no longer warns that the key lives only here.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByText("This key is saved only in this browser.")).toHaveCount(0);
});

test("an approval with a different pubky is refused in a toast and nothing is recorded", async ({
  page,
}) => {
  const net = await mockRingNetwork(page);
  await emulateCoarsePointer(page);
  await seedBrowserKey(page);
  await openVerifyBackup(page);
  await ringApproves(net, (await phoneVerificationRequest(page)).href, { seed: OTHER_KEY_SEED });

  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Pubky Ring approved with a different pubky." });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Nothing was recorded.");
  // No box in the card says it again; a phone, which shows no code to press, gets Try again.
  await expect(ringCard(page).getByRole("alert")).toHaveCount(0);
  await expect(ringCard(page).getByRole("button", { name: "Try again" })).toBeVisible();
  // The other key's approval was taken only to read its key, then let go of.
  expect(net.exchangedGrants).toEqual([[]]);
  expect(net.writes).toEqual([]);
  expect(await storedBackup(page)).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(OTHER_KEY);
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);
  await expect(ringCard(page)).toContainText("Never verified");
  // The file card is untouched.
  await expect(fileCard(page).getByLabel("Recovery file password")).toBeVisible();
});

test("the overview's warning and the removal confirmation both check a file on Verify your backup", async ({
  page,
}) => {
  await mockRingNetwork(page);
  await emulateCoarsePointer(page);
  await seedBrowserKey(page, { backup: { createdAt: "2026-09-01T10:00:00.000Z" } });

  // From the overview's warning: Back returns there.
  await page.getByRole("button", { name: "Check recovery file" }).click();
  await expect(page.getByRole("heading", { name: "Verify your backup." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();

  // From the removal confirmation: once the check passes, the page returns to the confirmation,
  // which now knows the file opens.
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page
    .getByRole("region", { name: "Backup & key access" })
    .getByRole("button", { name: "Remove from this browser" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Remove this key from this browser?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check recovery file" }).click();
  await expect(page.getByRole("heading", { name: "Verify your backup." })).toBeVisible();
  await fileCard(page).getByLabel("Recovery file", { exact: true }).setInputFiles(recoveryFile());
  await fileCard(page).getByLabel("Recovery file password").fill(RECOVERY_FILE_PASSWORD);
  await fileCard(page).getByRole("button", { name: "Verify recovery file" }).click();
  // Passed, the page goes back to the confirmation by itself.
  await expect(
    page.getByRole("heading", { name: "Remove this identity from this browser?" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("You checked a recovery file of this key on");
});

test("Migrate to Pubky Ring continues to Verify your backup, which can be skipped or passed", async ({
  page,
}) => {
  const net = await mockRingNetwork(page);
  await emulateCoarsePointer(page);
  await seedBrowserKey(page);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Migrate to Pubky Ring" }).click();
  await expect(page.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeVisible();
  await expect(page.getByText(/Continue to check that Pubky Ring holds it/u)).toBeVisible();

  // Skipped, the check is left for Manage.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Verify your backup." })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  expect(await storedBackup(page)).toBeNull();

  // Back returns to the export.
  await page.getByRole("button", { name: "Migrate to Pubky Ring" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeVisible();

  // Passed, it is recorded, the page leads on to Manage by itself, and Manage says so.
  await page.getByRole("button", { name: "Continue" }).click();
  await ringApproves(net, (await phoneVerificationRequest(page)).href);
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Backup & key access" }).getByRole("region", {
      name: "Verify",
    }),
  ).toContainText(/Last verified .+ \(Pubky Ring\)/u);
  expect(Object.keys((await storedBackup(page))!)).toEqual(["v", "ringVerifiedAt"]);
});

test("detaching from Google counts a Ring verification as the other backup", async ({ page }) => {
  await mockRingNetwork(page);
  await seedBrowserKey(page, {
    google: true,
    backup: { ringVerifiedAt: "2026-09-01T10:00:00.000Z" },
  });
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Detach from Google" }).click();

  await expect(page.getByRole("heading", { name: "Back up your pubky first." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Pubky Ring signed in with this key on");
  await expect(page.getByText(/you’ll type ONLY COPY/u)).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to detach" }).click();
  await page.getByRole("button", { name: "Detach from Google" }).click();
  // The plain confirmation word: this browser does not keep the only copy.
  await expect(page.getByLabel("Type DETACH to confirm")).toBeVisible();
  await expect(page.getByLabel("Type ONLY COPY to confirm")).toHaveCount(0);
});
