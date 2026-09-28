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
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Not available in your country")).toBeVisible();
  const warningBounds = await page.getByText("Not available in your country").boundingBox();
  const cardBounds = await page.getByRole("group", { name: "Phone verification" }).boundingBox();
  expect(warningBounds).not.toBeNull();
  expect(cardBounds).not.toBeNull();
  expect(warningBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y);
  expect(warningBounds!.y + warningBounds!.height).toBeLessThanOrEqual(
    cardBounds!.y + cardBounds!.height,
  );
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue with Lightning" })).toBeEnabled();
  await expect(page).toHaveURL(/\/$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("regional-availability.png"), fullPage: true });
  // The blocked card and its warning must also fit a narrow phone without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Not available in your country")).toBeVisible();
  const narrow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.innerWidth);
  const narrowWarning = await page.getByText("Not available in your country").boundingBox();
  expect(narrowWarning!.x).toBeGreaterThanOrEqual(0);
  expect(narrowWarning!.x + narrowWarning!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("regional-availability-390.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Enter invite manually" }).click();
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
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText(/Couldn’t check all verification methods/)).toBeVisible();
  await expect(page.getByText("Not available in your country")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enter invite manually" })).toBeEnabled();
  offline = false;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toBeEnabled();
});

test("Google regional restrictions limit only new Google identities", async ({ page }) => {
  await page.route("**/google_verification", (route) => route.fulfill({ status: 403, body: "" }));
  await page.goto("/");
  await expect(
    page.getByText(/New Google identities are not available in your country/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Import backup" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enter invite manually" })).toBeEnabled();
});
