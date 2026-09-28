import { INVITE_ONLY_PROVIDER } from "./helpers/e2eServer";
import { expect, test } from "./helpers/passportTest";

// Runs only in the `invite-only` project, against a server without Google, Homegate or a keyring.
test("offers only manual invites on a provider without Google or Homegate", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();
  // Passport names no provider.
  await expect(page.getByText(/Hosted by/u)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Lightning" })).toHaveCount(0);

  await page.getByRole("button", { name: "Enter invite manually" }).click();
  await expect(page.locator("#invite-homeserver")).toHaveText(INVITE_ONLY_PROVIDER.homeserver);
  // The provider's homeserver only prefills the invite; any other one can be entered.
  await page.getByRole("button", { name: "Change homeserver" }).click();
  await expect(page.getByLabel("Homeserver")).toHaveValue(INVITE_ONLY_PROVIDER.homeserver);
});
