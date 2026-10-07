import type { Locator } from "@playwright/test";
import {
  expectNoncePreimageOnlyForPassport,
  mockGoogleCreation,
  SECURE_ORIGIN,
} from "./helpers/googleCreation";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { UNVERIFIED_BAND, UNVERIFIED_HEADING } from "./helpers/requester";
import { expect, test, type Page } from "./helpers/passportTest";
import { mockPublicProfile, PROFILE_KEY, seedProfileIdentity } from "./helpers/pubkyProfile";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const GOOGLE_ACCOUNT = {
  googleSubject: "google-1",
  name: "Alex Rivera",
  email: "alex.rivera@example.com",
  pictureUrl: null,
};
/** A request without callbacks: cancelling it needs no network. */
const REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox" +
  "&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Client%20App";
/** An app that labels itself as someone else; its callbacks name the website it really is. */
const LABELLED_REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox" +
  "&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Google%20Account" +
  ["success", "error", "cancel"]
    .map((outcome) => `&x-${outcome}=https://evil.example/${outcome}`)
    .join("");
/** A 320px phone, and the app's 520x760 popup zoomed to 200%. */
const NARROW = [
  { width: 320, height: 568 },
  { width: 260, height: 380 },
] as const;

function authorizeUrl(request: string): string {
  return `/authorize#d=${encodeURIComponent(request)}`;
}

async function seedGoogleIdentity(page: Page, publicKeyZ32 = FIRST_KEY): Promise<void> {
  await page.goto("/terms-of-service");
  await storeLocalIdentities(page, [{ publicKeyZ32, googleAccount: GOOGLE_ACCOUNT }], {
    active: publicKeyZ32,
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("each step names itself in the window title and takes focus on its heading", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeFocused();
  await expect(page).toHaveTitle("Let’s join Pubky | Pubky Passport");
  // Moving to Sign in from the header names and focuses that screen in turn.
  await page.getByRole("banner").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Pubky" })).toBeFocused();
  await expect(page).toHaveTitle("Sign in to Pubky | Pubky Passport");

  await seedGoogleIdentity(page);
  await page.goto(authorizeUrl(REQUEST));
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeFocused();
  // Nobody verified who asks, so the window is not named after the app's own label.
  await expect(page).toHaveTitle("Sign-in request | Pubky Passport");
  // One saved identity: the request opens straight on its review.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign-in cancelled." })).toBeFocused();
  await expect(page).toHaveTitle("Sign-in cancelled | Pubky Passport");
});

test("a plain link is never named after its label or website, in the heading or the title", async ({
  page,
}) => {
  await seedGoogleIdentity(page);
  await page.goto(authorizeUrl(LABELLED_REQUEST));
  // M3: no hello bound this request, so its label and callback host name nobody.
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeFocused();
  await expect(page).toHaveTitle("Sign-in request | Pubky Passport");
  await expect(page.getByText(/^Name in the request:/u)).toHaveText(
    "Name in the request: Google Account (unverified)",
  );
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toContainText(
    "Returns to evil.example (unverified)",
  );
  // One saved identity: the request opens straight on its review.
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
});

test("pill labels fit their pills in the popup zoomed to 200%", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 260, height: 380 });
  await page.goto("/");
  // A label may wrap at this width, but its pill holds all of it without clipping or pushing the
  // page sideways: every way in on Join, in both cards, and Join's header action to Sign in, which
  // stays beside the logo. Sign in has no header action (Back returns to Join); on it a phone's
  // keychain card has its button, and a computer's shows the code instead, which must fit this
  // width as well.
  const header = page.getByRole("banner");
  await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
  await expectPillsFit(
    page
      .getByRole("region")
      .getByRole("button", { name: /^(Manage your own keys|Continue with )/u }),
    2,
  );
  await expectHeaderActionFits(page, header.getByRole("button", { name: "Sign in" }));
  expect(await horizontalOverflow(page)).toBe(0);

  await header.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Pubky" })).toBeVisible();
  await expect(header.getByRole("button")).toHaveCount(0);
  // A phone's keychain section is named as Join's keys card is; a computer's card by its heading.
  const keychain = page.getByRole("region", {
    name: isMobile ? "Sovereign & Secure" : "Scan QR with keychain.",
    exact: true,
  });
  await expectPillsFit(
    keychain.getByRole("button", { name: /^Continue with /u }),
    isMobile ? 1 : 0,
  );
  if (!isMobile) {
    const tile = keychain.locator('[data-state="ready"]');
    await expect(tile.getByRole("img", { name: "Keychain connection QR code" })).toBeVisible({
      timeout: 15_000,
    });
    const box = (await tile.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(260);
  }
  await expectPillsFit(page.getByRole("button", { name: "Back", exact: true }), 1);
  expect(await horizontalOverflow(page)).toBe(0);
});

/** Each of `count` pills holds its whole label, however it wraps. */
async function expectPillsFit(pills: Locator, count: number): Promise<void> {
  await expect(pills).toHaveCount(count);
  for (const pill of await pills.all())
    expect(
      await pill.evaluate(
        (button) =>
          button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight,
      ),
    ).toBe(true);
}

/** The header row's action holds its label and sits inside the window, right of the logo. */
async function expectHeaderActionFits(page: Page, action: Locator): Promise<void> {
  await expectPillsFit(action, 1);
  const logo = (await page
    .getByRole("banner")
    .getByRole("img", { name: "Pubky", exact: true })
    .boundingBox())!;
  const box = (await action.boundingBox())!;
  expect(logo.x + logo.width).toBeLessThanOrEqual(box.x);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const viewport of NARROW) {
  test(`outcome, error and profile screens reflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(authorizeUrl("pubkyauth://signin?caps=nope"));
    await expect(page.getByRole("heading", { name: "Invalid sign-in link." })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    await seedGoogleIdentity(page);
    await page.goto(authorizeUrl(REQUEST));
    // One saved identity: the request opens straight on its review.
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign-in cancelled." })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    await mockPublicProfile(page, null);
    await seedProfileIdentity(page);
    await page.getByRole("button", { name: "Set up profile" }).click();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    // Back and Continue share one bar without running off its side, in the first screenful, and
    // the bar stays pinned to the window's bottom edge while the form scrolls under it.
    const actions = [
      page.getByRole("button", { name: "Back", exact: true }),
      page.getByRole("button", { name: "Continue", exact: true }),
    ];
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    for (const action of actions) {
      await expect(action).toBeInViewport({ ratio: 1 });
      const box = (await action.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    await page
      .getByRole("heading", { name: "Links", exact: true })
      .evaluate((heading) => heading.scrollIntoView({ block: "start", behavior: "instant" }));
    const bar = (await page.locator("[data-sticky-actions]").boundingBox())!;
    expect(Math.abs(bar.y + bar.height - viewport.height)).toBeLessThanOrEqual(1);
    for (const action of actions) await expect(action).toBeInViewport({ ratio: 1 });
    // Without a picture the avatar is the key's face, which is decoration (no name).
    const avatar = await page
      .getByRole("region", { name: "Avatar" })
      .locator("[data-facehash]")
      .boundingBox();
    expect(Math.abs(avatar!.width - avatar!.height)).toBeLessThanOrEqual(1);
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`"Continue with Google" stays on one line and the start page does not scroll at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const pill = page.getByRole("button", { name: "Continue with Google" });
    await expect(pill).toBeVisible();
    const labelId = await pill.getAttribute("aria-labelledby");
    const label = await page.locator(`[id="${labelId}"]`).boundingBox();
    expect(label!.height).toBeLessThanOrEqual(24);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height,
    );
  });
}

test("the overview starts its heading where the other popup screens do", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 760 });
  await seedGoogleIdentity(page);
  await page.goto("/");
  const overview = await page.getByRole("heading", { name: "Your pubky." }).boundingBox();
  await page.getByRole("button", { name: "Switch identity", exact: true }).click();
  const switcher = await page.getByRole("heading", { name: "Switch identity." }).boundingBox();
  expect(overview!.x).toBe(switcher!.x);
});

test("the detach review's illustration stays inside a 768px window", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await mockPublicProfile(page, null);
  await seedGoogleIdentity(page, PROFILE_KEY);
  await page.goto("/");
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Detach from Google" }).click();
  await page.getByRole("button", { name: "Continue to detach" }).click();
  await expect(page.getByRole("heading", { name: "Detach from Google." })).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
});

test("Backup ready keeps Continue inside the app's popup with the folder-copy note", async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 520, height: 760 });
  const google = await mockGoogleCreation(context, GOOGLE_ACCOUNT);
  await page.goto(`${SECURE_ORIGIN}${authorizeUrl(REQUEST)}`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  // Only the first Drive permission: the backup is made without its folder copy.
  await page.getByRole("button", { name: "Skip the folder copy" }).click();

  await expect(page.getByRole("heading", { name: "Backup ready." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/^No copy in your “Pubky Passport” Drive folder\./u)).toBeVisible();
  // Google's own popup: the wrapping key came with the nonce's preimage, Homegate never saw it.
  expectNoncePreimageOnlyForPassport(google);
  const scrollY = await page.evaluate(() => window.scrollY);
  const box = (await page.getByRole("button", { name: "Continue", exact: true }).boundingBox())!;
  expect(scrollY).toBe(0);
  expect(box.y + box.height).toBeLessThanOrEqual(760);
});

test("the Pubky Ring drawer fits a short, narrow window", async ({ page }) => {
  const phone = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  test.skip(phone, "A phone opens the key in Pubky Ring and is shown no code.");
  await page.setViewportSize({ width: 740, height: 360 });
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Migrate to Pubky Ring" }).click();
  await page.getByRole("button", { name: "Show QR code" }).click();
  const drawer = page.getByRole("dialog", { name: "Scan with Pubky Ring" });
  await expect(drawer).toBeVisible();
  for (const part of [
    drawer.getByRole("heading", { name: "Scan with Pubky Ring" }),
    drawer.getByRole("img", { name: "Pubky Ring migration QR code" }),
    drawer.getByRole("button", { name: "Close" }),
  ]) {
    const box = await part.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(360);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Show QR code" })).toBeFocused();
});

test("the Google explainer sheet opens on its title and closes from a real button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const mark = page.getByRole("button", { name: "About signing in with Google" });
  await mark.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: /Continue with Google/u });
  await expect(sheet.getByRole("heading", { name: /Continue with Google/u })).toBeFocused();
  const close = await sheet.getByRole("button", { name: "Close" }).boundingBox();
  expect(close!.width).toBeGreaterThanOrEqual(44);
  expect(close!.height).toBeGreaterThanOrEqual(44);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(mark).toBeFocused();
});

test("secondary actions are 44px touch targets on a touch screen", async ({ page }) => {
  await seedGoogleIdentity(page);
  test.skip(
    !(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)),
    "Needs a touch pointer (mobile-chromium).",
  );
  // Switch shows where there is another identity to pick, so a second one is saved.
  await storeLocalIdentities(page, [{ publicKeyZ32: SECOND_KEY }], { replace: false });
  await page.goto(authorizeUrl(REQUEST));
  const minimumSide = async (name: string) => {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    return Math.min(box!.width, box!.height);
  };
  // The request opens on its list; choosing an identity opens its review.
  await page
    .getByRole("list", { name: "Choose the identity to sign in with." })
    .getByRole("button")
    .first()
    .click();
  expect(await minimumSide("Switch identity")).toBeGreaterThanOrEqual(44);

  await page.goto("/");
  await page.getByRole("button", { name: "Authorize an app" }).click();
  expect(await minimumSide("Paste authorization link")).toBeGreaterThanOrEqual(44);
  // The field's text box fills the field, so a tap anywhere across it focuses the input.
  const link = page.getByRole("textbox", { name: "Authorization link" });
  const input = await link.boundingBox();
  const field = await link.locator("..").boundingBox();
  expect(field!.height - input!.height).toBeLessThanOrEqual(2);
});
