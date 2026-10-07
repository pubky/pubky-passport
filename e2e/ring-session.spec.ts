import { expect, test, type Page } from "./helpers/passportTest";
import { emulateCoarsePointer } from "./helpers/pointer";
import { OTHER_KEY, OTHER_KEY_SEED } from "./helpers/pubkyProfile";
import {
  mockRingNetwork,
  RING_KEY,
  ringApproves,
  type RingNetwork,
  seedRingIdentity,
  storedSessions,
} from "./helpers/pubkyRing";

// Passport keeps its write-only profile grant for a Ring-held identity in the SDK's browser session
// store, so that identity's next profile edit, even after a reload, needs no new approval. Pubky
// Ring is played by the real SDK signer in the test process and the homeserver by
// `mockRingNetwork`; see `helpers/pubkyRing.ts`. The specs read the keychain's request from its
// link, which a coarse pointer shows.

const PROFILE_CAPABILITIES = [
  "/pub/pubky.app/profile.json:w",
  "/pub/pubky.app/files/:w",
  "/pub/pubky.app/blobs/:w",
];
const PROFILE = {
  name: "Carol",
  bio: "Keeps her keys on her phone.",
  links: [],
  image: null,
  status: null,
};
const PROFILE_PATH = "/pub/pubky.app/profile.json";
const OVERVIEW = { name: "Your pubky." } as const;
const CONNECT = { name: "Connect your keychain." } as const;
const DISCONNECT = { name: "Disconnect keychain" } as const;
const CLASSIC_QR = { name: "Older Pubky Ring? Classic QR" } as const;

/**
 * Counts, from the next page load on, every moment the keychain was asked (its screen's heading or
 * a link to it in the page), however briefly.
 */
async function watchKeychainRequests(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    let asked = 0;
    Object.defineProperty(window, "__keychainAsked", { get: () => asked });
    new MutationObserver(() => {
      const heading = [...document.querySelectorAll("h1")].some((h1) =>
        /^Connect your\s*keychain\./u.test(h1.textContent ?? ""),
      );
      if (heading || document.querySelector('a[href^="pubkyauth:"]')) asked++;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  return () =>
    page.evaluate(() => (window as Window & { __keychainAsked?: number }).__keychainAsked ?? 0);
}

/** The link to the keychain's request: `kind` `signin_grant` by default, `signin` the legacy one. */
async function keychainRequest(page: Page, kind = "signin_grant"): Promise<string> {
  const link = page.getByRole("main").locator('a[href^="pubkyauth:"]');
  await expect(link).toHaveAttribute("href", new RegExp(`^pubkyauth://${kind}\\?`, "u"));
  return (await link.getAttribute("href"))!;
}

/** The keys whose profile grant the browser session store keeps, in key order. */
async function storedKeys(page: Page): Promise<string[]> {
  return (await storedSessions(page)).map(({ publicKey }) => publicKey).sort();
}

const toast = (page: Page, text: string) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

/** Passport's Ring identities: `RING_KEY`, then each of `others`; `RING_KEY` is the active one. */
async function seedRingIdentities(page: Page, others: string[] = []): Promise<void> {
  await seedRingIdentity(page);
  await page.evaluate((keys) => {
    for (const key of keys)
      localStorage.setItem(
        `pubky-passport/local-identities/v1/identity/${key}`,
        JSON.stringify({ v: 1, publicKeyZ32: key, keySource: "ring" }),
      );
  }, others);
}

/** Shows `key`'s overview, as a new visit after choosing it would. */
async function openOverviewOf(page: Page, key: string): Promise<void> {
  await page.evaluate(
    (key) => localStorage.setItem("pubky-passport/local-identities/v1/active", key),
    key,
  );
  await page.reload();
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected identity" })).toContainText(key);
}

/**
 * From the active Ring identity's overview: Edit profile asks the keychain, Ring approves with the
 * key of `seed`, and the editor opens on the grant, which is stored for that `key`. Back returns to
 * the overview. Returns the grant's ID.
 */
async function connectProfile(
  page: Page,
  net: RingNetwork,
  { key = RING_KEY, seed }: { key?: string; seed?: number } = {},
): Promise<string> {
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", CONNECT)).toBeVisible();
  await ringApproves(net, await keychainRequest(page), seed === undefined ? {} : { seed });
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => storedKeys(page)).toContain(key);
  const stored = (await storedSessions(page)).find(({ publicKey }) => publicKey === key)!;
  // Exactly Passport's write-only profile grant, under this origin's client ID.
  expect(stored).toMatchObject({
    capabilities: PROFILE_CAPABILITIES,
    clientId: new URL(page.url()).host,
  });
  expect(net.grantExchanges.at(-1)).toMatchObject({ grantId: stored.grantId, status: 200 });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  return stored.grantId;
}

test("a stored profile grant opens the editor after a reload and from an edit link, without the keychain", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: PROFILE });
  await emulateCoarsePointer(page);
  const asked = await watchKeychainRequests(page);
  await seedRingIdentity(page);
  await page.goto("/");
  // Nothing is stored yet: the overview offers no Disconnect.
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  await expect(page.getByRole("button", DISCONNECT)).toHaveCount(0);
  const grantId = await connectProfile(page, net);
  await expect(page.getByRole("button", DISCONNECT)).toBeVisible();

  // A new page load: the overview still offers Disconnect, and nothing has asked the keychain.
  await page.reload();
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  await expect(page.getByRole("button", DISCONNECT)).toBeVisible();
  const relayed = net.relayRequests.length;
  expect(await asked()).toBe(0);

  // Edit profile opens the editor at once: the grant is restored, and the keychain never asked.
  await page.getByRole("button", { name: "Edit profile" }).click();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Carol", { timeout: 15_000 });
  expect(await asked()).toBe(0);
  expect(net.relayRequests).toHaveLength(relayed);
  // The restore asked the homeserver for a fresh bearer for that same grant.
  expect(net.grantExchanges).toEqual([
    { grantId, status: 200, token: expect.any(String) },
    { grantId, status: 200, token: expect.any(String) },
  ]);
  const restored = net.grantExchanges[1]!.token;
  expect(restored).not.toBe(net.grantExchanges[0]!.token);

  // Saved on the restored grant: the write carries the bearer the restore minted.
  await name.fill("Carol Danvers");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  expect(net.writes).toEqual([`${RING_KEY} ${PROFILE_PATH}`]);
  expect(net.writeTokens).toEqual([restored]);

  // An edit link for that key opens its editor at once too, on a new page load.
  await page.goto("/privacy-policy");
  await page.goto(`/#edit-profile=${RING_KEY}`);
  await expect(name).toHaveValue("Carol", { timeout: 15_000 });
  expect(await asked()).toBe(0);
  expect(net.relayRequests).toHaveLength(relayed);
  expect(net.grantExchanges.map((exchange) => exchange.grantId)).toEqual([
    grantId,
    grantId,
    grantId,
  ]);
  await name.fill("Carol D.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Profile updated." })).toBeVisible({
    timeout: 15_000,
  });
  expect(net.writeTokens).toEqual([restored, net.grantExchanges[2]!.token]);
  // Nothing revoked it: the grant stays stored for the next edit.
  expect(net.grantSignouts).toEqual([]);
  expect(await storedKeys(page)).toEqual([RING_KEY]);
});

test("Disconnect keychain revokes the stored grant on the homeserver, and the next edit asks again", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: PROFILE });
  await emulateCoarsePointer(page);
  await seedRingIdentity(page);
  await page.goto("/");
  const grantId = await connectProfile(page, net);
  await page.reload();

  const disconnect = page.getByRole("button", DISCONNECT);
  await disconnect.click();
  await expect(toast(page, "Keychain disconnected")).toBeVisible();
  await expect(disconnect).toHaveCount(0);
  // The grant's session signed out, which revokes it on the homeserver, and its record is gone.
  expect(net.grantSignouts).toEqual([grantId]);
  expect(await storedKeys(page)).toEqual([]);
  // The identity stays, on its overview.
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected identity" })).toContainText(RING_KEY);

  // The next profile edit asks the keychain again, on this page and after a reload.
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", CONNECT)).toBeVisible();
  await keychainRequest(page);
  await page.reload();
  await expect(page.getByRole("button", DISCONNECT)).toHaveCount(0);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", CONNECT)).toBeVisible();
  // Only the sign-out restored the grant; nothing used it afterwards.
  expect(net.grantExchanges.map((exchange) => exchange.grantId)).toEqual([grantId, grantId]);
  expect(net.writes).toEqual([]);
});

test("a grant stored for one Ring identity never connects another, which asks for its own", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: PROFILE });
  await emulateCoarsePointer(page);
  const asked = await watchKeychainRequests(page);
  await seedRingIdentities(page, [OTHER_KEY]);
  await page.goto("/");
  const first = await connectProfile(page, net);

  // The other identity has nothing stored: no Disconnect, and Edit profile asks the keychain for
  // that key.
  await openOverviewOf(page, OTHER_KEY);
  await expect(page.getByRole("button", DISCONNECT)).toHaveCount(0);
  const exchanged = net.grantExchanges.length;
  const second = await connectProfile(page, net, { key: OTHER_KEY, seed: OTHER_KEY_SEED });
  expect(second).not.toBe(first);
  // Its own approval's exchange alone: the first identity's grant was not restored for it.
  expect(net.grantExchanges.slice(exchanged).map((exchange) => exchange.grantId)).toEqual([second]);
  expect(await storedKeys(page)).toEqual([RING_KEY, OTHER_KEY].sort());

  // Back on the first identity, its own grant still opens its editor without the keychain.
  await openOverviewOf(page, RING_KEY);
  await expect(page.getByRole("button", DISCONNECT)).toBeVisible();
  const askedBefore = await asked();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Carol", { timeout: 15_000 });
  expect(await asked()).toBe(askedBefore);
  expect(net.grantExchanges.at(-1)).toMatchObject({ grantId: first, status: 200 });
});

test("a stored grant the homeserver refuses is forgotten, and the keychain is asked again", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: PROFILE });
  await emulateCoarsePointer(page);
  await seedRingIdentity(page);
  await page.goto("/");
  const grantId = await connectProfile(page, net);
  await page.reload();
  await expect(page.getByRole("button", DISCONNECT)).toBeVisible();

  // Revoked elsewhere, as the keychain's Authorized Apps does: the homeserver refuses its restore.
  net.revokedGrants.add(grantId);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", CONNECT)).toBeVisible();
  expect(net.grantExchanges.at(-1)).toEqual({ grantId, status: 401 });
  await expect.poll(() => storedKeys(page)).toEqual([]);
  // Its record is gone, so the overview no longer offers to disconnect it.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  await expect(page.getByRole("button", DISCONNECT)).toHaveCount(0);
  // Nothing signed it out here: the homeserver had already let it go.
  expect(net.grantSignouts).toEqual([]);

  // A new approval stores a new grant, which the overview can disconnect again.
  const renewed = await connectProfile(page, net);
  expect(renewed).not.toBe(grantId);
  await expect(page.getByRole("button", DISCONNECT)).toBeVisible();
});

test("the classic QR switch's cookie connection is never stored: after a reload the keychain is asked again", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: PROFILE });
  await emulateCoarsePointer(page);
  await seedRingIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", CONNECT)).toBeVisible();
  const classic = page.getByRole("switch", CLASSIC_QR);
  await classic.click();
  await expect(classic).toBeChecked();
  await ringApproves(net, await keychainRequest(page, "signin"));

  // Connected the legacy way: a cookie sign-in, with no grant to store.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Carol", { timeout: 15_000 });
  expect(net.cookieSignins).toEqual([RING_KEY]);
  expect(net.grantExchanges).toEqual([]);
  expect(await storedKeys(page)).toEqual([]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  await expect(page.getByRole("button", DISCONNECT)).toHaveCount(0);

  // A new page load: the connection is gone, so Edit profile asks the keychain again.
  await page.reload();
  await expect(page.getByRole("heading", OVERVIEW)).toBeVisible();
  await expect(page.getByRole("button", DISCONNECT)).toHaveCount(0);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", CONNECT)).toBeVisible();
  await keychainRequest(page, "signin");
  // Switched back to grants, Passport looks for a stored grant first: there is none, so it asks.
  await classic.click();
  await expect(classic).not.toBeChecked();
  await keychainRequest(page);
  await expect(page.getByRole("heading", CONNECT)).toBeVisible();
  expect(net.grantExchanges).toEqual([]);
  expect(net.cookieSignins).toEqual([RING_KEY]);
});

test("removing a Ring identity from this browser revokes its stored grant and forgets it", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: PROFILE });
  await emulateCoarsePointer(page);
  await seedRingIdentity(page);
  await page.goto("/");
  const grantId = await connectProfile(page, net);
  await page.reload();
  await expect(page.getByRole("button", DISCONNECT)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Remove from this browser", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  // Its session signed out, which revokes the grant on the homeserver, and its record is gone.
  await expect.poll(() => net.grantSignouts).toEqual([grantId]);
  await expect.poll(() => storedKeys(page)).toEqual([]);
  expect(net.revokedGrants).toEqual(new Set([grantId]));
});
