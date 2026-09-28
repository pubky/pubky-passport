import { E2E_HTTP_RELAY_URL } from "./helpers/e2eServer";
import { expect, test, type Page } from "./helpers/passportTest";
import {
  delegatedKeyCount,
  mockRingNetwork,
  RING_KEY,
  ringApproves,
  seedRingIdentity,
} from "./helpers/pubkyRing";

// Pubky Ring is played by the real SDK signer in the test process; see `helpers/pubkyRing.ts`.
const PROFILE_CAPABILITIES = [
  "/pub/pubky.app/profile.json:w",
  "/pub/pubky.app/files/:w",
  "/pub/pubky.app/blobs/:w",
];
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const APP_REQUEST =
  `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}` +
  "&x-source=Client%20App&x-success=https%3A%2F%2Fclient.example%2Fsuccess" +
  "&x-error=https%3A%2F%2Fclient.example%2Ferror&x-cancel=https%3A%2F%2Fclient.example%2Fcancel";
const APP_REQUEST_WITHOUT_CALLBACKS = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client%20App`;

/** The profile connection's request, read from its link. */
async function profileConnectionRequest(page: Page): Promise<URL> {
  const link = page.getByRole("link", { name: "Connect in Ring", includeHidden: true });
  await expect(link).toHaveAttribute("href", /^pubkyauth:\/\//u);
  return new URL((await link.getAttribute("href"))!);
}

test("adds an existing Ring identity from the home page with a write-only grant, leaving its profile", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Pubky Ring" }).click();
  await expect(page.getByRole("heading", { name: "Connect your Ring." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish later" })).toHaveCount(0);

  const request = await profileConnectionRequest(page);
  expect(request.searchParams.get("caps")?.split(",")).toEqual(PROFILE_CAPABILITIES);
  expect(request.searchParams.get("relay")).toBe(E2E_HTTP_RELAY_URL);
  await expect.poll(() => net.relayRequests.length).toBeGreaterThan(0);
  await ringApproves(net, request.href);

  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByText("Carol", { exact: true })).toBeVisible();
  expect(net.exchangedGrants).toEqual([PROFILE_CAPABILITIES]);
  // An existing profile is not overwritten: nothing is written.
  expect(net.writes).toEqual([]);
  expect(
    await page.evaluate(
      (key) =>
        JSON.parse(localStorage.getItem(`pubky-passport/local-identities/v1/identity/${key}`)!),
      RING_KEY,
    ),
  ).toEqual({ v: 1, publicKeyZ32: RING_KEY, keySource: "ring" });
});

/** WebKit can take several seconds to write the SDK's IndexedDB key; the other engines take well under one. */
const DELEGATED_KEY_TIMEOUT_MS = 20_000;

test("an abandoned Ring connection leaves no delegated key in the browser", async ({ page }) => {
  await mockRingNetwork(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Pubky Ring" }).click();
  await profileConnectionRequest(page);
  // The SDK keeps the pending request's non-extractable PoP key in IndexedDB.
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);

  // Each new request replaces the previous one's key instead of adding to it.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Connect Pubky Ring" }).click();
    await profileConnectionRequest(page);
    await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(1);
    await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);
});

test("says so when the homeserver refuses the grant after Ring approved", async ({ page }) => {
  const net = await mockRingNetwork(page, { grantStatus: 403 });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Pubky Ring" }).click();
  await ringApproves(net, (await profileConnectionRequest(page)).href);

  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Ring approved, but your homeserver did not accept the connection.",
  );
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an unfinished Ring identity opens the app's request first, with one Ring action", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: null });
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  await seedRingIdentity(page, true);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST)}`);

  await expect(page.getByRole("heading", { name: "Sign in to Client App" })).toBeVisible();
  // Passport's own profile request waits until the app's request is done.
  await expect(page.getByRole("heading", { name: "Connect your Ring." })).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Pubky Ring profile connection QR code", includeHidden: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use Pubky Ring", exact: true })).toHaveCount(0);
  await expect(page.getByText(/You choose the identity to sign in with in Ring/u)).toBeVisible();

  await page.getByRole("button", { name: "Continue in Pubky Ring" }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Ring." })).toBeVisible();
  await expect(page.getByText(/After approving in Pubky Ring, return to the app/u)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Ring", includeHidden: true }),
  ).toHaveAttribute("href", APP_REQUEST);
  expect(net.relayRequests).toEqual([]);

  // Passport cannot see Ring's approval; the validated x-success callback is a hint for the app.
  await page.getByRole("button", { name: "I approved in Pubky Ring" }).click();
  await expect(page).toHaveURL("https://client.example/success");
  expect(net.relayRequests).toEqual([]);
});

test("without callbacks, the Ring screen sends the user back without claiming approval", async ({
  page,
}) => {
  await mockRingNetwork(page);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST_WITHOUT_CALLBACKS)}`);
  await page.getByRole("button", { name: "Use Pubky Ring", exact: true }).click();
  await page.getByRole("button", { name: "I approved in Pubky Ring" }).click();

  await expect(page.getByRole("heading", { name: "Return to the app." })).toBeVisible();
  await expect(page.getByText(/Passport cannot see the approval in Pubky Ring/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authorization complete." })).toHaveCount(0);
});
