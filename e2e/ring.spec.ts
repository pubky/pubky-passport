import { QRCodeSVG } from "qrcode.react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { E2E_HTTP_RELAY_URL } from "./helpers/e2eServer";
import { type BrowserContext, expect, test, type Page } from "./helpers/passportTest";
import { recordClipboard } from "./helpers/clipboard";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { emulateCoarsePointer } from "./helpers/pointer";
import {
  delegatedKeyCount,
  mockRingNetwork,
  retryFlakyEd25519KeyGeneration,
  RING_KEY,
  ringApproves,
  seedRingIdentity,
} from "./helpers/pubkyRing";
import { UNVERIFIED_HEADING, UNVERIFIED_WARNING } from "./helpers/requester";

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
/** A well-formed key for an identity saved with its key in this browser (`RING_KEY` is Ring's). */
const BROWSER_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
/** WebKit can take several seconds to write the SDK's IndexedDB key; the other engines take well under one. */
const DELEGATED_KEY_TIMEOUT_MS = 20_000;
const APP_REQUEST_WITHOUT_CALLBACKS = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client%20App`;

/**
 * The profile connection's request, read from its link. Only a phone gets the link (a computer
 * gets the QR code alone), so the specs reading it emulate a coarse pointer. The link is found by
 * its target: a phone's button reads "Opening Pubky Ring…" or "Open Pubky Ring" by turns.
 */
async function profileConnectionRequest(page: Page): Promise<URL> {
  const link = page
    .getByRole("region", { name: "Pubky Ring profile connection" })
    .locator('a[href^="pubkyauth:"]');
  await expect(link).toHaveAttribute("href", /^pubkyauth:\/\//u);
  return new URL((await link.getAttribute("href"))!);
}

test("adds an existing Ring identity from the home page with a write-only grant, leaving its profile", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  await emulateCoarsePointer(page);
  await page.goto("/");
  // The sign-in runs inside the start page's Pubky Ring card, once asked: no screen of its own.
  const card = page.getByRole("region", { name: "Pubky Ring", exact: true });
  await expect(card.getByRole("link")).toHaveCount(0);
  expect(net.relayRequests).toEqual([]);
  await card.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
  await expect(card.getByRole("link", { name: /^Open(ing)? Pubky Ring$/u })).toBeVisible();
  // No line under it says Passport is waiting.
  await expect(card.getByText(/Waiting for|Preparing your/u)).toHaveCount(0);
  // The card's own line says what it is for; the full instruction is kept for screen readers.
  await expect(card.getByText(/to add your pubky to Passport/u)).toHaveClass(/sr-only/u);
  await expect(card.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);

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

/** The modules of the code a scanner reads for `link`, as the page's own renderer draws them. */
function qrModules(link: string): string {
  const markup = renderToStaticMarkup(
    createElement(QRCodeSVG, { value: link, level: "H", marginSize: 0, size: 176 }),
  );
  // The last path is the dark modules; the one before it is the background.
  return [...markup.matchAll(/ d="([^"]+)"/gu)].at(-1)![1]!;
}

/** The centre of `box` along x. */
function centre(box: { x: number; width: number } | null): number {
  return box!.x + box!.width / 2;
}

test("a computer's Pubky Ring card shows its code at once: nothing to press, nothing to cancel", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A phone starts from the card's button; see the next test.");
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  const copied = await recordClipboard(page);
  await page.goto("/");

  const card = page.getByRole("region", { name: "Pubky Ring", exact: true });
  const code = card.getByRole("img", { name: "Pubky Ring profile connection QR code" });
  await expect(code).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  // The code is the card's content: no button to start it, no link, no Cancel.
  await expect(card.getByRole("button", { name: "Sign in with Pubky Ring" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Connect in Pubky Ring" })).toHaveCount(0);
  // No line under the code says Passport is waiting.
  await expect(card.getByText(/Waiting for|Preparing your/u)).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
  ).toBeVisible();
  await expect(card.getByRole("link", { name: "Get Pubky Ring on Google Play" })).toBeVisible();
  // Pubky's tile: light, the code at 176 in a 192 tile, Ring's mark over the centre.
  const tile = card.locator('[data-state="ready"]');
  const tileBox = (await tile.boundingBox())!;
  expect([tileBox.width, tileBox.height]).toEqual([192, 192]);
  const logo = (await tile.locator('img[src="/brand/ring-logo.svg"]').boundingBox())!;
  expect(Math.abs(centre(logo) - centre(tileBox))).toBeLessThanOrEqual(1);
  expect(Math.round(logo.width)).toBe(48);
  // The card lines everything up on its text edge: the code, then the store badges under it.
  const heading = (await card.getByRole("heading", { name: "Pubky Ring" }).boundingBox())!;
  expect(Math.abs(tileBox.x - heading.x)).toBeLessThanOrEqual(1);
  const appStore = card.getByRole("link", { name: "Download Pubky Ring on the App Store" });
  const appStoreBox = (await appStore.boundingBox())!;
  expect(appStoreBox.y).toBeGreaterThan(tileBox.y + tileBox.height);
  expect(Math.abs(appStoreBox.x - heading.x)).toBeLessThanOrEqual(1);
  // Corners as pubky.app's cards have them.
  expect(await card.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("8px");

  // Pressing the code copies its link and says so; the code itself does not change.
  const drawn = await code.locator("path").last().getAttribute("d");
  await card.getByRole("button", { name: "Copy authentication link" }).click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Authentication link copied" }),
  ).toBeVisible();
  const [link, ...others] = await copied();
  expect(others).toEqual([]);
  const request = new URL(link!);
  expect(request.protocol).toBe("pubkyauth:");
  expect(request.searchParams.get("caps")?.split(",")).toEqual(PROFILE_CAPABILITIES);
  expect(request.searchParams.get("relay")).toBe(E2E_HTTP_RELAY_URL);
  // What a phone scans is exactly the link that was copied.
  expect(drawn).toBe(qrModules(link!));
  expect(await code.locator("path").last().getAttribute("d")).toBe(drawn);

  // Scanned and approved in Pubky Ring, the identity is added as from a phone.
  await ringApproves(net, link!);
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByText("Carol", { exact: true })).toBeVisible();
  expect(net.exchangedGrants).toEqual([PROFILE_CAPABILITIES]);
  expect(net.writes).toEqual([]);
});

test("a phone's Pubky Ring card opens Ring from its one button, which stays, and Cancel ends it", async ({
  page,
  browserName,
}) => {
  // Otherwise a WebKit key generation that fails leaves the key in memory, and none is counted.
  await retryFlakyEd25519KeyGeneration(page);
  const net = await mockRingNetwork(page);
  await emulateCoarsePointer(page);
  // Every QR code that ever enters the page, however briefly.
  await page.addInitScript(() => {
    let seen = 0;
    Object.defineProperty(window, "__qrSeen", { get: () => seen });
    new MutationObserver((records) => {
      for (const record of records)
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches('[aria-label$="QR code"]')) seen++;
          seen += node.querySelectorAll('[aria-label$="QR code"]').length;
        });
    }).observe(document, { childList: true, subtree: true });
  });
  const qrSeen = () => page.evaluate(() => (window as Window & { __qrSeen?: number }).__qrSeen);
  const handoffs: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("pubkyauth:")) handoffs.push(request.url());
  });
  const channels = () => new Set(net.relayRequests.filter((request) => request.startsWith("GET ")));

  await page.goto("/");
  const card = page.getByRole("region", { name: "Pubky Ring", exact: true });
  const start = card.getByRole("button", { name: "Sign in with Pubky Ring" });
  await expect(start).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Nothing is prepared before the press.
  expect(net.relayRequests).toEqual([]);
  const pressedAt = (await start.boundingBox())!;

  // One press: the request is made and Pubky Ring opens with it, from a button in the very place
  // of the one pressed, with Cancel beneath it and no line saying Passport waits.
  await start.click();
  const button = card
    .getByRole("region", { name: "Pubky Ring profile connection" })
    .locator("a, button")
    .first();
  const cancel = card.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  const cancelAt = (await cancel.boundingBox())!;
  const at = (await button.boundingBox())!;
  expect([at.x, at.y, at.width, at.height]).toEqual([
    pressedAt.x,
    pressedAt.y,
    pressedAt.width,
    pressedAt.height,
  ]);
  await expect(button).toHaveAttribute("href", /^pubkyauth:\/\//u);
  const href = (await button.getAttribute("href"))!;
  if (browserName !== "firefox") await expect.poll(() => handoffs).toEqual([href]);
  await expect(card.getByText(/Waiting for|Preparing your/u)).toHaveCount(0);
  expect(await cancel.boundingBox()).toEqual(cancelAt);
  await expect(
    card.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
  ).toBeVisible();

  // No app opened here: after the wait the same button, in the same place, offers another try.
  await page.waitForTimeout(2_500);
  await expect(button).toHaveAccessibleName("Open Pubky Ring");
  expect(await button.boundingBox()).toEqual(at);
  // Pubky Ring took the page over and gave it back: nothing changes.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(await button.boundingBox()).toEqual(at);
  expect(await cancel.boundingBox()).toEqual(cancelAt);
  expect(await qrSeen()).toBe(0);

  // Pressing it again opens Ring with the same request: no second one is made.
  await button.click();
  await expect(button).toHaveAttribute("href", href);
  if (browserName !== "firefox") await expect.poll(() => handoffs).toEqual([href, href]);
  expect(channels().size).toBe(1);
  expect(await qrSeen()).toBe(0);

  // Cancel ends the request: its delegated key is cleared, and the card is as before the press.
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(1);
  await cancel.click();
  await expect(start).toBeFocused();
  await expect(card.getByRole("status")).toHaveCount(0);
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);
});

test("keeps profile edits across a Ring reconnect and publishes them only on Save", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, {
    profile: {
      name: "Carol",
      bio: "Keeps her keys on her phone.",
      links: [{ title: "Website", url: "https://carol.example/" }],
      image: null,
      status: null,
    },
  });
  await emulateCoarsePointer(page);
  await seedRingIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit profile" }).click();
  // The shared Ring hand-off: what to do, the way to Ring, and where to get Pubky Ring; no
  // line says Passport is waiting.
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open(ing)? Pubky Ring$/u })).toBeVisible();
  await expect(page.getByText(/Waiting for|Preparing your/u)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
  ).toBeVisible();
  await ringApproves(net, (await profileConnectionRequest(page)).href);

  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Carol");
  await name.fill("Carol Danvers");
  await page.getByLabel("Bio", { exact: true }).fill("Pilot. Keeps her keys on her phone.");
  // The homeserver refuses the grant's first write: the grant has ended.
  let refused = false;
  await page.route("https://homeserver.example/**", async (route) => {
    if (route.request().method() !== "PUT" || refused) return route.fallback();
    refused = true;
    return route.fulfill({ status: 403, body: "grant expired" });
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Your edits are kept.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reconnect Pubky Ring" }).click();
  // The edits wait for this connection, so leaving it asks first.
  await expect(
    page.getByText("Your unsaved profile changes are kept until you leave."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Discard your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible();
  await ringApproves(net, (await profileConnectionRequest(page)).href);

  await expect(name).toHaveValue("Carol Danvers");
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue(
    "Pilot. Keeps her keys on her phone.",
  );
  await expect(page.getByText("Pubky Ring is connected again.", { exact: false })).toBeVisible();
  expect(net.writes).toEqual([]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saved, the editor returns to the overview it was opened from.
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  expect(net.writes.some((write) => write.endsWith("/pub/pubky.app/profile.json"))).toBe(true);
});

test("an abandoned Ring connection leaves no delegated key in the browser", async ({ page }) => {
  // Otherwise a WebKit key generation that fails leaves the key in memory, and none is counted.
  await retryFlakyEd25519KeyGeneration(page);
  await mockRingNetwork(page);
  await emulateCoarsePointer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
  await profileConnectionRequest(page);
  // The SDK keeps the pending request's non-extractable PoP key in IndexedDB.
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(1);
  // Cancel closes the connection inside the card and gives its button back.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in with Pubky Ring" })).toBeFocused();
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);

  // Each new request replaces the previous one's key instead of adding to it.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
    await profileConnectionRequest(page);
    await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);
});

test("says so in a toast when the homeserver refuses the grant after Ring approved", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { grantStatus: 403 });
  await emulateCoarsePointer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
  await ringApproves(net, (await profileConnectionRequest(page)).href);

  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText: "Pubky Ring approved, but your homeserver did not accept the connection.",
    }),
  ).toBeVisible();
  // No box in the card says it again; a phone, which shows no code to press, gets Try again.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a computer's spent code turns into its blurred tile, which starts a new request, and the toast says why", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A phone shows no code; see the test above.");
  const net = await mockRingNetwork(page, { grantStatus: 403 });
  const copied = await recordClipboard(page);
  await page.goto("/");
  const card = page.getByRole("region", { name: "Pubky Ring", exact: true });
  const copy = card.getByRole("button", { name: "Copy authentication link" });
  await expect(copy).toBeVisible({ timeout: 15_000 });
  await copy.click();
  const [first] = await copied();
  await ringApproves(net, first!);

  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText: "Pubky Ring approved, but your homeserver did not accept the connection.",
    }),
  ).toBeVisible();
  // Only the tile, in the code's place: no box under it and no Try again.
  const reload = card.getByRole("button", { name: "Reload sign-in QR code" });
  await expect(reload).toBeVisible();
  await expect(card.getByText("Click to reload")).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await reload.click();
  await expect(
    card.getByRole("img", { name: "Pubky Ring profile connection QR code" }),
  ).toBeVisible();
  // A new request, under a new secret.
  await copy.click();
  await expect.poll(async () => (await copied()).length).toBe(2);
  expect((await copied())[1]).not.toBe(first);
});

test("a saved Ring identity is not offered for an app's request: Ring signs through the hand-off", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: null });
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  await seedRingIdentity(page, true);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST)}`);

  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  // Passport's own profile request never stands in front of the app's request.
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Pubky Ring profile connection QR code", includeHidden: true }),
  ).toHaveCount(0);
  // Passport cannot sign with a key that stays in Ring, so with only that identity saved the
  // request opens as it does with nothing saved: on the start page, without a list or a review.
  await expect(page.getByRole("region", { name: "Create account" })).toBeVisible();
  await expect(page.getByText("Key in Pubky Ring", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Choose the identity to sign in with." }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  // A plain link names nobody, here either: the hand-off warns instead (M3).
  await expect(page.getByText(/approve the sign-in\.$/u)).toBeVisible();
  await expect(page.getByText(/Client App/u)).toHaveCount(0);
  await expect(page.getByText(UNVERIFIED_WARNING)).toBeVisible();
  // A computer shows the code; a phone opens Ring with the app's request, unchanged, and shows no
  // code it could not scan.
  const phone = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (phone) {
    await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveAttribute("href", APP_REQUEST);
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
  } else await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
  expect(net.relayRequests).toEqual([]);

  // Nobody reports Ring's approval here: Passport goes on only once it sees the app's relay
  // channel answered, and claims nothing before.
  await expect(page.getByRole("button", { name: /approved|Back to /u })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^(Signed in to|Return to)/u })).toHaveCount(0);
  expect(net.relayRequests).toEqual([]);
});

test("an app's request lists only identities whose key this browser holds", async ({ page }) => {
  await mockRingNetwork(page, { profile: { name: "Carol" } });
  await seedRingIdentity(page);
  // A second identity, with its key in this browser; the Ring identity stays the active one.
  await storeLocalIdentities(page, [{ publicKeyZ32: BROWSER_KEY }], { replace: false });
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST)}`);

  const list = page.getByRole("list", { name: "Choose the identity to sign in with." });
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(page.getByText("Key in Pubky Ring", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Pubky Ring" })).toBeVisible();

  // Choosing the browser-held identity opens its review; Ring never stands in for it.
  await list.getByRole("button").click();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
  await expect(page.getByText("Key in Pubky Ring", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("pubky-passport/local-identities/v1/active")),
  ).toBe(BROWSER_KEY);
});

test("a Ring identity is in Passport for its profile only, removed from its overview", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  await seedRingIdentity(page);
  await page.goto("/");

  // The overview: the profile, the pubky, Log out in Manage's place, and Switch; nothing signs or
  // handles the key, and there is no Manage screen.
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  const overview = page.getByRole("region", { name: "Selected identity" });
  await expect(overview.getByText(RING_KEY)).toBeVisible();
  await expect(overview.getByText("Key in Pubky Ring")).toBeVisible();
  await expect(overview.getByRole("button")).toHaveText([/Edit profile/u, /Log out/u, /Switch/u]);
  const remove = overview.getByRole("button", { name: "Log out" });
  const switchButton = overview.getByRole("button", { name: "Switch identity" });
  // Side by side, on the row under Edit profile, each on one line, down to a 390px phone.
  for (const width of [page.viewportSize()!.width, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const removeBox = (await remove.boundingBox())!;
    const switchBox = (await switchButton.boundingBox())!;
    expect(Math.abs(removeBox.y - switchBox.y)).toBeLessThanOrEqual(1);
    expect(removeBox.height).toBe(switchBox.height);
  }
  for (const name of [
    "Manage identity",
    "Authorize an app",
    "Check recovery file",
    "Verify backup",
    "Download recovery file",
    "Migrate to Pubky Ring",
    "Attach to Google",
  ])
    await expect(page.getByRole("button", { name })).toHaveCount(0);

  // Cancel returns to the overview, the identity untouched.
  await remove.click();
  await expect(
    page.getByRole("heading", { name: "Remove this identity from this browser?" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Your key stays in Pubky Ring");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();

  // Its profile editor's Back returns to the overview too, never to a Manage screen.
  await overview.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toHaveCount(0);

  await overview.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Remove from this browser", exact: true }).click();
  // Nothing is saved any more: the start page, with its Pubky Ring card.
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pubky Ring", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(`pubky-passport/local-identities/v1/identity/${key}`),
      RING_KEY,
    ),
  ).toBeNull();
  expect(net.writes).toEqual([]);
});

/**
 * The app's relay, an inbox answering `/ack` reads as http-relay does: `404` until Ring posts,
 * `false` while the answer waits for the app, `true` once the app took it. Records every request.
 */
async function fakeAppRelay(context: BrowserContext) {
  const relay = {
    answer: "none" as "none" | "posted" | "taken",
    requests: [] as { method: string; path: string; ack: string }[],
  };
  await context.route("https://relay.client.example/**", (route) => {
    const request = route.request();
    const ack = { none: "404", posted: "false", taken: "true" }[relay.answer];
    relay.requests.push({ method: request.method(), path: new URL(request.url()).pathname, ack });
    return ack === "404"
      ? route.fulfill({ status: 404, body: "Not found" })
      : route.fulfill({ status: 200, body: ack, contentType: "text/plain" });
  });
  return relay;
}

/** Every look was a read of the acknowledgement on the app's channel, never of the answer. */
function expectOnlyAckReads(relay: Awaited<ReturnType<typeof fakeAppRelay>>): void {
  const looks = new Set(relay.requests.map(({ method, path }) => `${method} ${path}`));
  expect(looks.size).toBe(1);
  expect([...looks][0]).toMatch(/^GET \/inbox\/[\w-]{43}\/ack$/u);
}

test("in the app's popup, goes back to the app by itself only once the app took Ring's answer", async ({
  context,
  page,
}) => {
  const relay = await fakeAppRelay(context);
  await page.goto("/");
  const passportOrigin = new URL(page.url()).origin;
  await context.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  // The app's page: it acknowledges Passport's outcome message, as the integration guide asks.
  await page.goto("https://client.example/integration");
  await page.evaluate((trustedOrigin) => {
    window.addEventListener("message", (event) => {
      const message = event.data as Record<string, unknown>;
      if (event.origin !== trustedOrigin || message.type !== "pubky-passport.authorization-outcome")
        return;
      (event.source as Window | null)?.postMessage(
        {
          type: "pubky-passport.authorization-outcome-ack",
          version: 1,
          messageId: message.messageId,
        },
        trustedOrigin,
      );
      Object.defineProperty(window, "__passportOutcome", { value: message.outcome });
    });
  }, passportOrigin);
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(
    (url) => {
      window.open(url, "pubky-passport", "popup,width=520,height=760");
    },
    `${passportOrigin}/authorize#d=${encodeURIComponent(APP_REQUEST)}`,
  );
  const popup = await popupPromise;
  await popup.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  // Passport watches the relay with no line saying it waits.
  await expect(popup.getByText(/Waiting for|continues by itself/u)).toHaveCount(0);
  await expect.poll(() => relay.requests.length, { timeout: 10_000 }).toBeGreaterThan(0);

  // Ring answers; until the app takes the answer, Passport stays and claims nothing.
  relay.answer = "posted";
  await expect
    .poll(() => relay.requests.some(({ ack }) => ack === "false"), { timeout: 10_000 })
    .toBe(true);
  await expect(popup.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();

  relay.answer = "taken";
  await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true);
  expect(
    await page.evaluate(
      () => (window as Window & { __passportOutcome?: string }).__passportOutcome,
    ),
  ).toBe("success");
  expectOnlyAckReads(relay);
});

test("in the same tab, goes back to the app by itself once Ring's answer waits for it", async ({
  context,
  page,
}) => {
  const net = await mockRingNetwork(page);
  const relay = await fakeAppRelay(context);
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST)}`);
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  await expect.poll(() => relay.requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();

  // No SDK listens while Passport is shown: the app takes the answer once Passport navigates back.
  relay.answer = "posted";
  await expect(page).toHaveURL("https://client.example/success", { timeout: 10_000 });
  expectOnlyAckReads(relay);
  expect(net.relayRequests).toEqual([]);
});

test("without callbacks, goes to Passport's home once it saw Ring's answer reach the app", async ({
  context,
  page,
}) => {
  await mockRingNetwork(page);
  const relay = await fakeAppRelay(context);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST_WITHOUT_CALLBACKS)}`);
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  // Without callbacks the request names no website, so its own label names nothing here.
  await expect(page.getByText(/Client App/u)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /approved|Back to /u })).toHaveCount(0);

  relay.answer = "posted";
  // Nothing saved in this browser: Passport's home is its start page, with no request in it.
  await expect(page.getByRole("region", { name: "Create account" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /^(Signed in to|Return to)/u })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: /Sign-in request from/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  expectOnlyAckReads(relay);
});
