import { INVITE_ONLY_PROVIDER } from "./helpers/e2eServer";
import { expect, test } from "./helpers/passportTest";
import { HOMESERVER, mockHomeserverRecords } from "./helpers/pubkyProfile";

// Runs only in the `invite-only` project, against a server without Google, Homegate or a keyring.
test("offers only manual invites on a provider without Google or Homegate", async ({ page }) => {
  // The test homeserver's record is served; the provider's is not.
  await mockHomeserverRecords(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  // Passport names no provider.
  await expect(page.getByText(/Hosted by/u)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Google/u })).toHaveCount(0);

  // Join offers the one way in here, keys of your own, alone: no Google card beside it.
  await expect(page.getByRole("region", { name: "Quick & Easy" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button")).toHaveText(["Manage your own keys"]);
  await page.getByRole("button", { name: "Manage your own keys" }).click();

  // With an invite the only way to verify, the invite entry opens directly instead of a method
  // list, in the onboarding's wide column, with the provider's terms that list would have shown.
  await expect(page.getByRole("heading", { name: "Use invite." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prove you’re not a robot." })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Phone number", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Bitcoin payment/u })).toHaveCount(0);
  await expect(page.getByText(/Creating an account here needs an invite code/u)).toBeVisible();
  await expect(page.getByRole("main")).toHaveCSS("max-width", "1280px");
  await expect(page.locator("#invite-homeserver")).toHaveText(INVITE_ONLY_PROVIDER.homeserver);
  // The provider's homeserver only prefills the invite; any other one can be entered.
  await page.getByRole("button", { name: "Change homeserver" }).click();
  const homeserver = page.getByLabel("Homeserver public key");
  await expect(homeserver).toHaveValue(INVITE_ONLY_PROVIDER.homeserver);
  await expect(page.getByRole("button", { name: "Use this homeserver" })).toHaveCount(0);
  // The key already in the field is checked as it opens; no record is served for this one.
  await expect(
    page.getByText("Passport could not reach this homeserver.", { exact: false }),
  ).toBeVisible();
  await expect(homeserver).toHaveAttribute("aria-invalid", "true");
  // A key that is not one is explained where it was typed, without asking any server.
  await homeserver.fill("my-homeserver.example");
  await homeserver.press("Enter");
  await expect(page.getByText(/A homeserver public key is 52 letters and digits/u)).toBeVisible();
  await expect(homeserver).toBeFocused();
  // A reachable homeserver turns the field green once the person leaves it.
  await homeserver.fill(HOMESERVER);
  await homeserver.press("Tab");
  await expect(page.getByText("Homeserver found.")).toBeVisible();
  await expect(homeserver).not.toHaveAttribute("aria-invalid");
  await expect(page.getByLabel("Enter invite code")).toBeFocused();

  // Back leaves account creation, as there is no method list to return to.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
});
