import { INVITE_ONLY_PROVIDER } from "./helpers/e2eServer";
import { expect, test } from "./helpers/passportTest";

// Runs only in the `invite-only` project, against a server without Google, Homegate or a keyring.
test("offers only manual invites on a provider without Google or Homegate", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  // Passport names no provider.
  await expect(page.getByText(/Hosted by/u)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);

  // The first step already says an invite is needed.
  await expect(page.getByText(/Create an account with an invite code/u)).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Lightning" })).toHaveCount(0);

  // With one way to verify there is nothing to choose: the invite entry opens directly, in the
  // step column, with the provider's terms that the method list would have shown.
  await expect(page.getByRole("heading", { name: "Use Invite." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter invite manually" })).toHaveCount(0);
  await expect(page.getByText(/Creating an account here needs an invite code/u)).toBeVisible();
  await expect(page.getByRole("main")).toHaveCSS("max-width", "588px");
  await expect(page.locator("#invite-homeserver")).toHaveText(INVITE_ONLY_PROVIDER.homeserver);
  // The provider's homeserver only prefills the invite; any other one can be entered.
  await page.getByRole("button", { name: "Change homeserver" }).click();
  const homeserver = page.getByLabel("Homeserver public key");
  await expect(homeserver).toHaveValue(INVITE_ONLY_PROVIDER.homeserver);
  // A key that is not one is explained where it was typed; Enter uses the entry.
  await homeserver.fill("my-homeserver.example");
  await homeserver.press("Enter");
  await expect(page.getByText(/A homeserver public key is 52 letters and digits/u)).toBeVisible();
  await expect(homeserver).toBeFocused();
  await homeserver.fill(INVITE_ONLY_PROVIDER.homeserver);
  await homeserver.press("Enter");
  await expect(page.locator("#invite-homeserver")).toHaveText(INVITE_ONLY_PROVIDER.homeserver);

  // Back leaves account creation, as there is no method list to return to.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
});
