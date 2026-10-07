import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "./helpers/passportTest";

/** Join → Manage your own keys: Verify, where the way to verify a new account is picked. */
async function openVerification(page: Page) {
  await page.getByRole("button", { name: "Manage your own keys" }).click();
  await expect(page.getByRole("heading", { name: "Prove you’re not a robot." })).toBeVisible();
}

/** `inner` lies within `outer`'s box, so the reason reads as part of its method. */
async function expectInside(inner: Locator, outer: Locator) {
  const innerBounds = (await inner.boundingBox())!;
  const outerBounds = (await outer.boundingBox())!;
  expect(innerBounds.x).toBeGreaterThanOrEqual(outerBounds.x);
  expect(innerBounds.y).toBeGreaterThanOrEqual(outerBounds.y);
  expect(innerBounds.x + innerBounds.width).toBeLessThanOrEqual(outerBounds.x + outerBounds.width);
  expect(innerBounds.y + innerBounds.height).toBeLessThanOrEqual(
    outerBounds.y + outerBounds.height,
  );
}

test("regional blocks disable signup methods while Google restore stays available", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.route("**/google_verification", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/sms_verification/info", (route) => route.fulfill({ status: 403, body: "" }));
  await page.goto("/");
  // Restoring a Google identity does not use Homegate, so its signup route is not a gate.
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await openVerification(page);
  // Verify keeps the blocked method in its place, disabled, and says once what is left.
  const phone = page.getByRole("group", { name: "Phone verification" });
  await expect(phone.getByRole("button", { name: "Phone number", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Bitcoin payment/u })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Invite code", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("status").filter({ hasText: /available in your country/u }),
  ).toHaveText(
    "Phone verification isn’t available in your country. You can use Bitcoin payment or an invite code.",
  );
  // A blocked method is a fact, not a failed check: nothing to check again.
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
  // The reason sits on the method it is about: a banner over its card on a computer, a badge
  // beside its button on a phone.
  const reason = isMobile
    ? phone.getByRole("button", { name: "Why is this not available?" })
    : phone.getByText("Not available in your country", { exact: true });
  await expect(reason).toBeVisible();
  await expectInside(reason, phone);
  await expect(page).toHaveURL(/\/$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("regional-availability.png"), fullPage: true });
  // The disabled method and its reason must also fit a narrow phone without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  const badge = phone.getByRole("button", { name: "Why is this not available?" });
  await expect(badge).toBeVisible();
  const narrow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.innerWidth);
  await expectInside(badge, phone);
  // The badge opens the reason and what to do instead, inside the page too.
  await badge.click();
  const popover = page
    .getByRole("status")
    .filter({ hasText: "Try a different verification method" });
  await expect(popover).toContainText("Not available in your country");
  const popoverBounds = (await popover.boundingBox())!;
  expect(popoverBounds.x).toBeGreaterThanOrEqual(0);
  expect(popoverBounds.x + popoverBounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("regional-availability-390.png"),
    fullPage: true,
  });
  // Escape closes it, and the other methods are one press away.
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await page.getByRole("button", { name: "Invite code", exact: true }).click();
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
  await openVerification(page);
  await expect(page.getByText(/Couldn’t check all verification methods/)).toBeVisible();
  await expect(page.getByText(/not available in your country/iu)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Phone number", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Invite code", exact: true })).toBeEnabled();
  offline = false;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("button", { name: "Phone number", exact: true })).toBeEnabled();
});

test("Google regional restrictions limit only new Google identities", async ({ page }) => {
  let blocked = true;
  await page.route("**/google_verification", (route) =>
    route.fulfill({ status: blocked ? 403 : 405, body: "" }),
  );
  await page.goto("/");
  // The note, its retry and the sign-in that restores all sit in Join's Google card.
  const card = page.getByRole("region", { name: "Quick & Easy" });
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
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // The other ways to create an account are unaffected.
  await openVerification(page);
  await expect(page.getByRole("button", { name: "Phone number", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Invite code", exact: true })).toBeEnabled();
  // Nor is a restore from a recovery file, on Sign in.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import it" })).toBeEnabled();
});
