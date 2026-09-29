import { storeLocalIdentities } from "./helpers/localIdentities";
import { expect, test, type Page } from "./helpers/passportTest";
import { mockPublicProfile, PROFILE_KEY, seedProfileIdentity } from "./helpers/pubkyProfile";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
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
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeFocused();
  await expect(page).toHaveTitle("Get your pubky | Pubky Passport");

  await seedGoogleIdentity(page);
  await page.goto(authorizeUrl(REQUEST));
  await expect(page.getByRole("heading", { name: "Sign in to Client App" })).toBeFocused();
  // The request names no website, so the window is not named after the app's own label.
  await expect(page).toHaveTitle("Sign-in request | Pubky Passport");
  await page
    .getByRole("list", { name: "Choose the identity to sign in with." })
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("main").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Sign-in cancelled." })).toBeFocused();
  await expect(page).toHaveTitle("Sign-in cancelled | Pubky Passport");
});

test("a request's window title names its website beside the app's own label", async ({ page }) => {
  await seedGoogleIdentity(page);
  await page.goto(authorizeUrl(LABELLED_REQUEST));
  const title = "Sign in to Google Account (evil.example) | Pubky Passport";
  await expect(page.getByRole("heading", { name: "Sign in to Google Account" })).toBeFocused();
  await expect(page).toHaveTitle(title);
  await page
    .getByRole("list", { name: "Choose the identity to sign in with." })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to Google Account" })).toBeFocused();
  await expect(page).toHaveTitle(title);
});

test("short pill labels stay on one line in the popup zoomed to 200%", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 380 });
  await page.goto("/");
  for (const name of ["Create account", "Import backup"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box!.height).toBe(60);
  }
});

for (const viewport of NARROW) {
  test(`outcome, error and profile screens reflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(authorizeUrl("pubkyauth://signin?caps=nope"));
    await expect(page.getByRole("heading", { name: "Invalid sign-in link." })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    await seedGoogleIdentity(page);
    await page.goto(authorizeUrl(REQUEST));
    await page
      .getByRole("list", { name: "Choose the identity to sign in with." })
      .getByRole("button")
      .first()
      .click();
    await page.getByRole("main").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Sign-in cancelled." })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    await mockPublicProfile(page, null);
    await seedProfileIdentity(page);
    await page.getByRole("button", { name: "Set up profile" }).click();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    // Back and Finish stack instead of running off the edge, and the avatar stays round.
    const back = await page.getByRole("button", { name: "Back", exact: true }).boundingBox();
    const finish = await page.getByRole("button", { name: "Finish" }).boundingBox();
    expect(back!.x + back!.width).toBeLessThanOrEqual(viewport.width);
    expect(finish!.x + finish!.width).toBeLessThanOrEqual(viewport.width);
    const avatar = await page.getByRole("img", { name: "Profile avatar preview" }).boundingBox();
    expect(Math.abs(avatar!.width - avatar!.height)).toBeLessThanOrEqual(1);
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`"Continue with Google" stays on one line beside the art at ${viewport.width}px`, async ({
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
  await page.getByRole("button", { name: "I backed up my pubky" }).click();
  await expect(page.getByRole("heading", { name: "Detach from Google." })).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
});

test("the Pubky Ring drawer fits a phone on its side", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Use in Pubky Ring" }).click();
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
  await page.goto(authorizeUrl(REQUEST));
  await page
    .getByRole("list", { name: "Choose the identity to sign in with." })
    .getByRole("button")
    .first()
    .click();
  const minimumSide = async (name: string) => {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    return Math.min(box!.width, box!.height);
  };
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
