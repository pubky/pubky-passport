import { recordClipboard } from "./helpers/clipboard";
import { test, expect, type Page } from "./helpers/passportTest";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { mockPublicProfile, PROFILE_KEY } from "./helpers/pubkyProfile";
import {
  CLIENT_RELAY_SECRET,
  clientAuthorizationPath,
  clientAuthRequest,
} from "./helpers/pubkyAuthRequests";
import { mockRingNetwork } from "./helpers/pubkyRing";

/**
 * The v27 onboarding's own behaviour: its three start screens and the app's `entry=` hint, a
 * request's Join (with its recovery file and keychain lines), Back on a request's first screen,
 * the geoblocked method's badge, Passport's classic QR switch, and the ranked permission list. The
 * flows themselves are covered by create-account, ring and profile.
 */

const CANCEL = "https://client.example/cancelled";
const CLASSIC_QR = "Older Pubky Ring? Classic QR";
/** A computer's keychain card on the plain Sign in, named by its heading. */
const KEYCHAIN_QR_CARD = "Scan QR with keychain.";
/** A request's Join hands the request to the keychain from this line (a grant request). */
const USE_KEYCHAIN = "Use Pubky Ring or Bitkit";
const LEGAL_CONSENT =
  "By joining and creating a Pubky account, you agree to the Terms of Service and Privacy Policy, and confirm you are at least 18 years old.";

/** The plain Sign in, opened from Join's header, and a computer's keychain card. */
async function openPlainSignIn(page: Page) {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Pubky" })).toBeVisible();
  return page.getByRole("main").getByRole("region", { name: KEYCHAIN_QR_CARD, exact: true });
}

/** The consent line under the ways to create an account, with the two pages it links. */
async function expectLegalConsent(page: Page, newTab: boolean) {
  const consent = page.getByRole("main").getByText(/^By joining and creating a Pubky account/u);
  await expect(consent).toBeVisible();
  // The line reads the same either way; a new tab is said in the links' names only.
  await expect(consent).toHaveText(LEGAL_CONSENT);
  const links = consent.getByRole("link");
  await expect(links).toHaveCount(2);
  for (const [name, href] of [
    ["Terms of Service", "/terms-of-service"],
    ["Privacy Policy", "/privacy-policy"],
  ] as const) {
    const link = consent.getByRole("link", { name: new RegExp(`^${name}`, "u") });
    await expect(link).toHaveAttribute("href", href);
    // While a request waits, reading them must not navigate its window away.
    if (newTab) {
      await expect(link).toHaveAccessibleName(`${name} (opens in a new tab)`);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    } else {
      await expect(link).toHaveAccessibleName(name);
      await expect(link).not.toHaveAttribute("target");
    }
  }
}

async function openRequest(page: Page, extra = "", capabilities = "/pub/example.app/:rw") {
  await openRequestLink(
    page,
    clientAuthRequest({ capabilities, callbacks: { cancel: CANCEL } }),
    extra,
  );
}

/** Opens `request` as a plain link: no opener, so no hello can bind it. */
async function openRequestLink(page: Page, request: string, extra = "") {
  await page.route("https://relay.client.example/**", () => undefined);
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Client</title>" }),
  );
  await page.goto(clientAuthorizationPath(request) + extra);
}

test("without a request the start page opens on Join and moves to Sign in and back", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account setup progress" })).toContainText(
    "Step 1 of 3: Create account",
  );
  await expect(page.getByRole("button", { name: "Manage your own keys" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Apple/u })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Pubky" })).toBeVisible();
  // Sign in is not a step of account creation.
  await expect(page.getByRole("navigation", { name: "Account setup progress" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import it" })).toBeVisible();
  // Join, where Sign in was opened from, is one Back away.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  await page.getByRole("button", { name: "Manage your own keys" }).click();
  await expect(page.getByRole("heading", { name: "Prove you’re not a robot." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
});

test("without a request, Sign in is the keychain and a recovery file alone, and Back returns to Join, where Google is", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Pubky" })).toBeVisible();
  const main = page.getByRole("main");
  // One way in: the keychain, Passport's own connection. A phone starts it from its button, in a
  // section named as Join's keys card is; a computer shows its code at once, with the classic QR
  // switch under it, in a card named by its heading.
  const keychain = main.getByRole("region", {
    name: isMobile ? "Sovereign & Secure" : KEYCHAIN_QR_CARD,
    exact: true,
  });
  await expect(keychain).toBeVisible();
  await expect(main.getByRole("region")).toHaveCount(1);
  if (isMobile)
    await expect(
      keychain.getByRole("button", { name: "Continue with Pubky Ring or Bitkit", exact: true }),
    ).toBeVisible();
  else {
    await expect(keychain.getByRole("img", { name: "Keychain connection QR code" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      keychain.getByRole("switch", { name: "Older Pubky Ring? Classic QR" }),
    ).toBeVisible();
  }
  // Then the recovery file; nothing else, and nothing that creates an account.
  await expect(main.getByRole("button", { name: "Import it", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Quick & Easy" })).toHaveCount(0);
  for (const name of [/Google/u, /Manage your own keys/u])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  for (const text of ["Quick & Easy", "Continue with Google", "or create account"])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  // Nothing here creates an account, so nothing asks to agree to the terms of one.
  await expect(page.getByText(/^By joining and creating a Pubky account/u)).toHaveCount(0);
  // Join is one Back away, so the header leads nowhere: no "New here?", there or anywhere.
  await expect(page.getByRole("banner").getByRole("button")).toHaveCount(0);
  await expect(page.getByText("New here?")).toHaveCount(0);
  // A phone's screen ends on the keychain's picture; a computer's has none.
  const picture = main.locator('img[src*="keychain.png"]');
  if (isMobile) {
    await expect(picture).toBeVisible();
    const [pictureBox, importBox] = await Promise.all(
      [picture, main.getByRole("button", { name: "Import it", exact: true })].map(
        async (locator) => (await locator.boundingBox())!,
      ),
    );
    expect(pictureBox!.y).toBeGreaterThanOrEqual(importBox!.y + importBox!.height);
  } else await expect(picture).toBeHidden();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Quick & Easy", exact: true })
      .getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
});

test("on a 1280x800 computer, the plain Sign in's keychain card is one row: the code with its switch under it, then the heading and the steps", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "a phone's card has a button and no code");
  await mockRingNetwork(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const card = await openPlainSignIn(page);
  const code = card.getByRole("img", { name: "Keychain connection QR code" });
  await expect(code).toBeVisible({ timeout: 15_000 });
  // The tile the code is drawn on, which pressing copies.
  const tile = card.getByRole("button", { name: "Copy authentication link" });
  const classic = card.getByRole("switch", { name: CLASSIC_QR });
  await expect(classic).toBeVisible();
  // The switch's line: pressing anywhere on it toggles the switch.
  const classicLine = card
    .locator("label")
    .filter({ has: page.getByRole("switch", { name: CLASSIC_QR }) });
  const heading = card.getByRole("heading", { name: KEYCHAIN_QR_CARD, exact: true });
  await expect(
    card.getByText("Use Pubky Ring or Bitkit and follow the instructions below.", { exact: true }),
  ).toBeVisible();
  const steps = card.getByRole("listitem");
  await expect(steps).toHaveText([
    "Open Pubky Ring or Bitkit",
    "Tap ‘Scan’",
    "Scan this QR",
    "Authorize in the app",
  ]);

  const [cardBox, tileBox, lineBox, headingBox] = await Promise.all(
    [card, tile, classicLine, heading].map(async (locator) => (await locator.boundingBox())!),
  );
  const tileBottom = tileBox!.y + tileBox!.height;
  const tileRight = tileBox!.x + tileBox!.width;
  // Directly under the code, within its column.
  expect(lineBox!.y).toBeGreaterThanOrEqual(tileBottom);
  expect(lineBox!.y - tileBottom).toBeLessThanOrEqual(16);
  expect(lineBox!.x).toBeGreaterThanOrEqual(tileBox!.x - 1);
  expect(lineBox!.x + lineBox!.width).toBeLessThanOrEqual(tileRight + 1);
  // The heading and every step beside the code, in the same row.
  const rowBottom = lineBox!.y + lineBox!.height;
  for (const box of [
    headingBox!,
    ...(await Promise.all((await steps.all()).map(async (step) => (await step.boundingBox())!))),
  ]) {
    expect(box.x).toBeGreaterThanOrEqual(tileRight);
    expect(box.y).toBeGreaterThanOrEqual(tileBox!.y);
    expect(box.y + box.height).toBeLessThanOrEqual(rowBottom + 1);
  }
  // The card is as tall as that row and its padding.
  expect(cardBox!.height).toBeLessThanOrEqual(360);
  expect(cardBox!.y).toBeLessThanOrEqual(tileBox!.y);
  expect(cardBox!.y + cardBox!.height).toBeGreaterThanOrEqual(rowBottom);
});

test("the classic QR switch says only its label", async ({ page, isMobile }) => {
  test.skip(isMobile, "a phone's card shows no code, so no switch until it is opened");
  await mockRingNetwork(page);
  const card = await openPlainSignIn(page);
  const classic = card.getByRole("switch", { name: CLASSIC_QR, exact: true });
  await expect(classic).toBeVisible({ timeout: 15_000 });
  // Its line is the label and nothing more, and no sentence anywhere on the card explains it.
  await expect(
    card.locator("label").filter({ has: page.getByRole("switch", { name: CLASSIC_QR }) }),
  ).toHaveText(CLASSIC_QR, { useInnerText: true });
  await expect(card.getByText(/classic/iu)).toHaveCount(1);
  await expect(card.getByText(/older than 2\.0|works only with/u)).toHaveCount(0);
});

test("Join and Verify show the consent to the terms, with its two pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  await expectLegalConsent(page, false);
  await page.getByRole("button", { name: "Manage your own keys" }).click();
  await expect(page.getByRole("heading", { name: "Prove you’re not a robot." })).toBeVisible();
  await expectLegalConsent(page, false);
  // The footer's own links stay as they were, apart from the line's.
  await expect(
    page
      .getByRole("navigation", { name: "Legal" })
      .getByRole("link", { name: "Terms of Service", exact: true }),
  ).toHaveAttribute("href", "/terms-of-service");
});

test("a plain request with nothing saved opens on Join, with the recovery file and the keychain under its cards and the consent line last", async ({
  page,
  isMobile,
}) => {
  await openRequest(page);
  const join = page.getByRole("heading", { name: "Let’s join Pubky." });
  await expect(join).toBeVisible();
  // The first step of account creation, as without a request.
  await expect(page.getByRole("navigation", { name: "Account setup progress" })).toContainText(
    "Step 1 of 3: Create account",
  );
  // Back answers the app, so the header leads to no Sign in; nothing of the old request Sign in.
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: /Sign in/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in to Pubky" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Sign in with keychain/u })).toHaveCount(0);
  await expect(page.getByText(/Sign in with keychain/u)).toHaveCount(0);
  await expect(page.getByText("or create account", { exact: true })).toHaveCount(0);

  const keys = page.getByRole("region", { name: "Sovereign & Secure" });
  const google = page.getByRole("region", { name: "Quick & Easy" });
  await expect(
    keys.getByRole("button", { name: "Manage your own keys", exact: true }),
  ).toBeVisible();
  await expect(
    google.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  // Under the cards: a recovery file, then the keychain, which takes the app's request as it is.
  // No hello can bind a plain link, so the keychain line is not held back for one.
  const importIt = page.getByRole("button", { name: "Import it", exact: true });
  const keychain = page.getByRole("button", { name: USE_KEYCHAIN, exact: true });
  await expect(importIt).toBeVisible();
  await expect(importIt).toHaveAccessibleDescription("Have a recovery file?");
  await expect(keychain).toBeVisible();
  await expect(page.getByRole("button", { name: "Use Pubky Ring", exact: true })).toHaveCount(0);
  // The consent line comes last, and its pages open in a new tab while the request waits.
  await expectLegalConsent(page, true);
  const consent = page.getByRole("main").getByText(/^By joining and creating a Pubky account/u);
  const [keysBox, googleBox, importBox, keychainBox, consentBox] = await Promise.all(
    [keys, google, importIt, keychain, consent].map(
      async (locator) => (await locator.boundingBox())!,
    ),
  );
  for (const card of [keysBox!, googleBox!])
    expect(importBox!.y).toBeGreaterThanOrEqual(card.y + card.height);
  // A touch screen's 44px targets reach into the space around their lines, so the lines are
  // ordered by their middles.
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(middle(keychainBox!)).toBeGreaterThan(importBox!.y + importBox!.height);
  expect(consentBox!.y).toBeGreaterThan(middle(keychainBox!));

  // The keychain line hands the request over: a computer's code, a phone's button to the app.
  await keychain.click();
  await expect(page.getByRole("heading", { name: "Sign in with keychain." })).toBeVisible();
  if (isMobile)
    await expect(page.getByRole("main").locator('a[href^="pubkyauth:"]')).toHaveAttribute(
      "href",
      /^pubkyauth:\/\/signin_grant\?/u,
    );
  else await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
  // Back returns to Join, whose own Back answers the app.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(join).toBeVisible();
  await expect(keychain).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`^${CANCEL}`, "u"));
});

test("a legacy cookie request's Join names Pubky Ring alone, the one keychain that takes it", async ({
  page,
}) => {
  const request =
    `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox` +
    `&secret=${CLIENT_RELAY_SECRET}&x-source=ClientFixture&x-cancel=${encodeURIComponent(CANCEL)}`;
  await openRequestLink(page, request);
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  const ring = page.getByRole("button", { name: "Use Pubky Ring", exact: true });
  await expect(ring).toBeVisible();
  await expect(page.getByRole("button", { name: USE_KEYCHAIN, exact: true })).toHaveCount(0);
  await ring.click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(ring).toBeVisible();
});

for (const [entry, heading] of [
  ["", "Let’s join Pubky."],
  ["&entry=sign-in", "Let’s join Pubky."],
  ["&entry=join", "Let’s join Pubky."],
  ["&entry=google", "Continue with Google."],
] as const) {
  test(`a request${entry ? ` with ${entry.slice(1)}` : ""} opens on ${heading}, where Back answers the app`, async ({
    page,
  }) => {
    await openRequest(page, entry);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    // Back on the request's first screen is its cancel: the app hears it at its callback.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${CANCEL}`, "u"));
  });
}

test("in the app's 520x760 pop-up, a request's Join shows new keys, Google and the keychain without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 760 });
  await openRequest(page);
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  for (const name of ["Manage your own keys", "Continue with Google", "Import it", USE_KEYCHAIN])
    await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("an unknown entry is not a request Passport opens", async ({ page }) => {
  await openRequest(page, "&entry=signup");
  await expect(page.getByRole("heading", { name: /Invalid|can’t be used/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toHaveCount(0);
});

test("the Google screen explains the split and waits for a press", async ({ page }) => {
  await openRequest(page, "&entry=google");
  await expect(page.getByText("Google’s role:")).toBeVisible();
  await expect(page.getByText("Split security:")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Google/u })).toBeEnabled();
  // It starts an account too, so it carries the consent line, whose pages leave the request be.
  await expectLegalConsent(page, true);
});

test("a method blocked in the person's country stays, dimmed, and says why", async ({
  page,
  context,
  isMobile,
}) => {
  await context.route("**/ln_verification/info", (route) =>
    route.fulfill({ status: 403, body: "" }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Manage your own keys" }).click();
  await expect(page.getByRole("button", { name: /Bitcoin payment/u })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Phone number" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Invite code" })).toBeEnabled();
  if (isMobile) {
    await page.getByRole("button", { name: "Why is this not available?" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Try a different verification method" }),
    ).toBeVisible();
  } else
    await expect(
      page.getByText("Not available in your country", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
  // A blocked method is a fact, not a failed check: nothing to check again.
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
});

test("Passport's classic QR switch makes its own keychain request the legacy kind, per device", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "a phone opens the keychain app instead of showing a code");
  const copied = await recordClipboard(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  const code = page.getByRole("img", { name: "Keychain connection QR code" });
  await expect(code).toBeVisible();
  const copiedLink = async () => {
    await page.getByRole("button", { name: "Copy authentication link" }).click();
    return (await copied()).at(-1) ?? "";
  };
  expect(await copiedLink()).toMatch(/^pubkyauth:\/\/signin_grant\?/u);
  const toggle = page.getByRole("switch", { name: "Older Pubky Ring? Classic QR" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(copiedLink).toMatch(/^pubkyauth:\/\/signin\?/u);
  // Kept for this device: a new visit starts with the legacy kind.
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("switch", { name: "Older Pubky Ring? Classic QR" })).toBeChecked();
  await expect(code).toBeVisible();
  await expect.poll(copiedLink).toMatch(/^pubkyauth:\/\/signin\?/u);
});

test("the permission list puts what can change above what can only be read, private first", async ({
  page,
}) => {
  await mockPublicProfile(page, { name: "Satoshi" });
  await page.goto("/");
  await storeLocalIdentities(page, [{ publicKeyZ32: PROFILE_KEY }], { active: PROFILE_KEY });
  await openRequest(
    page,
    "",
    "/pub/example.app/:r,/pub/pubky.app/:rw,/priv/social/:r,/priv/app.locks/:rw",
  );
  const change = page.getByRole("list", { name: "Can read and change" });
  const read = page.getByRole("list", { name: "Can only read" });
  await expect(change.getByRole("listitem")).toHaveText([
    /^Private: Your Locks content/u,
    /^Public: Your public Pubky social data/u,
  ]);
  await expect(read.getByRole("listitem")).toHaveText([
    /^Private: Your private Pubky social data/u,
    /^Public: An app's data/u,
  ]);
  await expect(
    page.getByText(
      "Anyone can already see public data; private data is only visible to you and the apps you allow.",
      { exact: true },
    ),
  ).toBeVisible();
});
