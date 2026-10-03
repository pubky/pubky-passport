import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/passportTest";

test("regional blocks disable signup methods while Google restore stays available", async ({
  page,
}, testInfo) => {
  await page.route("**/google_verification", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/sms_verification/info", (route) => route.fulfill({ status: 403, body: "" }));
  await page.goto("/");
  // Restoring a Google identity does not use Homegate, so its signup route is not a gate.
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  // The start page's Create account card disables the blocked method and says why once, in view,
  // naming what is left.
  const create = page.getByRole("region", { name: "Create account" });
  await expect(create.getByRole("button", { name: "Continue with SMS" })).toBeDisabled();
  await expect(create.getByRole("button", { name: "Continue with Lightning" })).toBeEnabled();
  const reason = page.getByRole("status").filter({ hasText: /available in your country/u });
  await expect(reason).toHaveText(
    "SMS isn’t available in your country. You can use Lightning or an invite code.",
  );
  await expect(reason).toBeVisible();
  // The reason sits in the card, under the method it is about.
  const reasonBounds = await reason.boundingBox();
  const cardBounds = await create.boundingBox();
  expect(reasonBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y);
  expect(reasonBounds!.y + reasonBounds!.height).toBeLessThanOrEqual(
    cardBounds!.y + cardBounds!.height,
  );
  await expect(page).toHaveURL(/\/$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("regional-availability.png"), fullPage: true });
  // The disabled method and its reason must also fit a narrow phone without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reason).toBeVisible();
  const narrow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.innerWidth);
  const narrowReason = await reason.boundingBox();
  expect(narrowReason!.x).toBeGreaterThanOrEqual(0);
  expect(narrowReason!.x + narrowReason!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("regional-availability-390.png"),
    fullPage: true,
  });
  await create.getByRole("button", { name: "Enter invite manually" }).click();
  await expect(page.getByLabel("Enter invite code")).toBeVisible();
});

test("unknown availability remains distinct from geography and can be retried", async ({
  page,
}) => {
  let offline = true;
  await page.route("**/sms_verification/info", (route) =>
    offline ? route.abort("failed") : route.fulfill({ status: 200, body: "" }),
  );
  await page.goto("/");
  await expect(page.getByText(/Couldn’t check all verification methods/)).toBeVisible();
  await expect(page.getByText(/not available in your country/iu)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enter invite manually" })).toBeEnabled();
  offline = false;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toBeEnabled();
});

test("Google regional restrictions limit only new Google identities", async ({ page }) => {
  let blocked = true;
  await page.route("**/google_verification", (route) =>
    route.fulfill({ status: blocked ? 403 : 405, body: "" }),
  );
  await page.goto("/");
  // The note, its retry and the sign-in that restores all sit in the Create account card.
  const card = page.getByRole("region", { name: "Create account" });
  const note = card.getByRole("status").filter({ hasText: /Google sign-ups/u });
  await expect(note).toContainText(
    "New Google sign-ups aren’t available in your country. You can still restore a pubky you created with Google.",
  );
  await expect(card.getByRole("button", { name: "Restore with Google" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  blocked = false;
  await note.getByRole("button", { name: "Check again" }).focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  // The re-check's result is said where it was asked, and keyboard focus stays in the card.
  await expect(note).toHaveText("New Google sign-ups are available here.");
  await expect(note).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  blocked = true;
  await page.reload();
  await expect(card.getByRole("button", { name: "Restore with Google" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Import it" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // The other ways to create an account are unaffected.
  await expect(card.getByRole("button", { name: "Continue with SMS" })).toBeEnabled();
  await expect(card.getByRole("button", { name: "Enter invite manually" })).toBeEnabled();
});
