import { storeLocalIdentities, type SeededIdentity } from "./helpers/localIdentities";
import { PKARR_RELAY_HOSTS } from "./helpers/network";
import { expect, test, type Page } from "./helpers/passportTest";
import { mockPublicProfile, PROFILE_KEY } from "./helpers/pubkyProfile";
import { UNVERIFIED_BAND } from "./helpers/requester";

const GOOGLE_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const RING_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const PLAIN_KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
/** Ten more well-formed keys for a long list. */
const MANY_KEYS = Array.from(
  { length: 10 },
  (_, index) => `${"ybndrfg8ejkmcpqxot1uwisza345h769"[index]}${PLAIN_KEY.slice(1)}`,
);
const REQUEST =
  "pubkyauth://signin?caps=/pub/notes.example/:rw&relay=https://relay.notes.example/inbox" +
  "&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Acme%20Notes" +
  "&x-success=https%3A%2F%2Fnotes.example%2Fsuccess&x-error=https%3A%2F%2Fnotes.example%2Ferror" +
  "&x-cancel=https%3A%2F%2Fnotes.example%2Fcancel";
const BROAD_REQUEST = REQUEST.replace("caps=/pub/notes.example/:rw", "caps=/:rw");
const POPUP = { width: 520, height: 760 };
/** The start page a request opens on when Passport has no identity to sign it with. */
const START_HEADING = { name: "Let’s join Pubky." } as const;
/** The list's and the review's way to the person's keychain app (Pubky Ring or Bitkit). */
const KEYCHAIN = "Continue with keychain";
/**
 * The start page's way to Pubky Ring: `REQUEST` is the legacy kind, which only Pubky Ring
 * approves, so the line under Join's cards names Ring alone.
 */
const RING = "Use Pubky Ring";

async function seedIdentities(page: Page) {
  await page.goto("/");
  await storeLocalIdentities(
    page,
    [
      { publicKeyZ32: PLAIN_KEY },
      {
        publicKeyZ32: GOOGLE_KEY,
        googleAccount: {
          googleSubject: "google-work",
          name: "Work",
          email: "work@example.com",
          pictureUrl: null,
        },
      },
    ],
    { active: GOOGLE_KEY },
  );
  // A Ring-held identity has no secret key in the browser: saved for its profile, never listed.
  await page.evaluate((key) => {
    localStorage.setItem(
      `pubky-passport/local-identities/v1/identity/${key}`,
      JSON.stringify({ v: 1, publicKeyZ32: key, keySource: "ring" }),
    );
  }, RING_KEY);
}

async function openRequest(page: Page) {
  await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
  // Every step of a plain link's request says that nobody confirmed who asks.
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
}

function identityList(page: Page) {
  return page.getByRole("list", { name: "Choose the identity to sign in with." });
}

/** The bottom edge of each named button, to compare with the window's height. */
async function bottoms(page: Page, names: readonly string[]): Promise<number[]> {
  return Promise.all(
    names.map(async (name) => {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    }),
  );
}

/** Deep links the page followed, the hand-off to Pubky Ring. */
function recordHandoffs(page: Page): string[] {
  const handoffs: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().startsWith("pubkyauth:")) handoffs.push(outgoing.url());
  });
  return handoffs;
}

test.describe("choosing an identity first", () => {
  test.use({ viewport: POPUP });

  test("lists the identities Passport can sign with, the other ways in right below, then reviews the one chosen", async ({
    page,
  }) => {
    await seedIdentities(page);
    await openRequest(page);

    // Three identities are saved; the one whose key stays in Pubky Ring is not listed.
    const rows = identityList(page).getByRole("button");
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("Key in Pubky Ring", { exact: true })).toHaveCount(0);
    // The identity used last comes first.
    await expect(rows.first()).toContainText("work@example.com");
    await expect(page.getByText("or", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
    // As on the review, the other ways in follow the list at the screen's gap, nothing is pinned,
    // and the page footer comes last (at the popup's bottom edge when the page fits it).
    const lastRow = (await identityList(page).getByRole("listitem").last().boundingBox())!;
    const or = (await page.getByText("or", { exact: true }).boundingBox())!;
    expect(or.y - (lastRow.y + lastRow.height)).toBeGreaterThan(0);
    expect(or.y - (lastRow.y + lastRow.height)).toBeLessThanOrEqual(32);
    expect(await page.locator("[data-sticky-actions]").count()).toBe(0);
    const layout = await page.evaluate(() => ({
      mainBottom: document.querySelector("main")!.getBoundingClientRect().bottom,
      footerTop: document.querySelector("body > footer")!.getBoundingClientRect().top,
      footerBottom: document.querySelector("body > footer")!.getBoundingClientRect().bottom,
      pageHeight: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
    }));
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.mainBottom - 1);
    if (layout.pageHeight <= POPUP.height)
      expect(Math.abs(layout.footerBottom - POPUP.height)).toBeLessThanOrEqual(1);
    expect(layout.width).toBeLessThanOrEqual(POPUP.width);
    for (const bottom of await bottoms(page, ["Use another identity", KEYCHAIN]))
      expect(bottom).toBeLessThanOrEqual(POPUP.height);

    await page.getByRole("button", { name: /tkrq…p7qy/u }).click();
    const selected = page.getByRole("region", { name: "Selected identity" });
    // The key keeps its own case in the review, as in the list.
    await expect(selected).toContainText("Pubky tkrq…p7qy");
    await expect(page.getByRole("heading", { name: "Requested permissions" })).toBeVisible();
    // The primary action stays in view in the popup; Cancel answers from the header.
    const [authorize] = await bottoms(page, ["Authorize"]);
    expect(authorize).toBeLessThanOrEqual(POPUP.height);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main").getByRole("button", { name: /Cancel/u })).toHaveCount(0);

    // Two identities can sign, so Switch leads back to the list.
    await page.getByRole("button", { name: "Switch identity", exact: true }).click();
    await expect(identityList(page).getByRole("button")).toHaveCount(2);
    await expect(identityList(page).getByRole("button").first()).toContainText("tkrq…p7qy");
  });

  test("with no identity, opens on Join: new keys and Google, then the recovery file and Pubky Ring, and Back answers the app", async ({
    page,
  }) => {
    await openRequest(page);

    await expect(page.getByRole("heading", START_HEADING)).toBeVisible();
    await expect(identityList(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use another identity" })).toHaveCount(0);
    // Every way in is on the screen: the header leads to no other one.
    await expect(page.getByRole("button", { name: "New here?" })).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("button", { name: "Sign in" })).toHaveCount(0);
    const keys = page.getByRole("region", { name: "Sovereign & Secure" });
    const google = page.getByRole("region", { name: "Quick & Easy" });
    const ring = page.getByRole("button", { name: RING, exact: true });
    const create = keys.getByRole("button", { name: "Manage your own keys", exact: true });
    const importIt = page.getByRole("button", { name: "Import it", exact: true });
    // New keys and Google first; under them the recovery file's quiet link and then Pubky Ring,
    // which answers the waiting app as it is.
    await expect(create).toBeVisible();
    await expect(
      google.getByRole("button", { name: "Continue with Google", exact: true }),
    ).toBeVisible();
    await expect(importIt).toBeVisible();
    await expect(ring).toBeVisible();
    await expect(page.getByText("or create account", { exact: true })).toHaveCount(0);
    const keysBox = (await keys.boundingBox())!;
    const googleBox = (await google.boundingBox())!;
    const importBox = (await importIt.boundingBox())!;
    const ringBox = (await ring.boundingBox())!;
    for (const card of [keysBox, googleBox])
      expect(importBox.y).toBeGreaterThanOrEqual(card.y + card.height);
    expect(ringBox.y + ringBox.height / 2).toBeGreaterThan(importBox.y + importBox.height);
    expect(await ring.evaluate((button) => getComputedStyle(button).borderColor)).not.toBe(
      "rgb(200, 255, 0)",
    );
    // On the request's first step Back is its Cancel: no other Cancel, and Back is in view in the
    // 520x760 popup, as are all three ways in.
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
    const back = page.getByRole("button", { name: "Back", exact: true });
    await expect(back).toBeInViewport();
    const waysIn = [RING, "Manage your own keys", "Continue with Google"];
    for (const bottom of await bottoms(page, waysIn))
      expect(bottom).toBeLessThanOrEqual(POPUP.height);

    // New keys open account creation, whose Back returns to Join.
    await create.click();
    await expect(page.getByRole("heading", { name: "Prove you’re not a robot." })).toBeVisible();
    await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
    await back.click();
    await expect(page.getByRole("heading", START_HEADING)).toBeVisible();
    await expect(ring).toBeVisible();

    // Back on Join, the request's first step, answers the app.
    await page.route("https://notes.example/**", (route) =>
      route.fulfill({ body: "<!doctype html><title>Notes</title>", contentType: "text/html" }),
    );
    await back.click();
    await expect(page).toHaveURL(/^https:\/\/notes\.example\/cancel/u);
  });

  test("the only identity's review has no Switch, Cancel in the header, and the list's or below Authorize", async ({
    page,
  }) => {
    await page.goto("/");
    await storeLocalIdentities(page, [{ publicKeyZ32: PLAIN_KEY }], { active: PLAIN_KEY });
    await openRequest(page);

    // One identity that can sign: the request opens on its review, with nothing to switch to.
    const authorize = page.getByRole("button", { name: "Authorize", exact: true });
    await expect(authorize).toBeVisible();
    await expect(identityList(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Switch identity" })).toHaveCount(0);
    // One Cancel, in the header as on the list; Authorize is the only action under the request.
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(1);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    // Then the same "or" as the list, all of it in view in the 760px popup.
    const or = page.getByText("or", { exact: true });
    const [authorizeBottom, anotherBottom, keychainBottom] = await bottoms(page, [
      "Authorize",
      "Use another identity",
      KEYCHAIN,
    ]);
    expect((await or.boundingBox())!.y).toBeGreaterThanOrEqual(authorizeBottom!);
    expect(anotherBottom).toBeGreaterThan(authorizeBottom!);
    for (const bottom of [authorizeBottom, anotherBottom, keychainBottom])
      expect(bottom).toBeLessThanOrEqual(POPUP.height);

    // Use another identity opens the start page, Join, and Back returns to the review.
    await page.getByRole("button", { name: "Use another identity", exact: true }).click();
    await expect(page.getByRole("heading", START_HEADING)).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(authorize).toBeVisible();

    // Cancel answers the app, as the bottom Cancel did.
    await page.route("https://notes.example/**", (route) =>
      route.fulfill({ body: "<!doctype html><title>Notes</title>", contentType: "text/html" }),
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/notes\.example\/cancel/u);
  });

  test("Use another identity opens the start page and Back returns to the list", async ({
    page,
  }) => {
    await seedIdentities(page);
    await openRequest(page);

    await expect(page.getByRole("button", { name: /Continue with Google or import/u })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Use another identity", exact: true }).click();
    // Still addressed to the waiting app, on Join with every way in.
    await expect(page.getByRole("heading", START_HEADING)).toBeVisible();
    await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
    for (const name of [RING, "Manage your own keys", "Continue with Google", "Import it"])
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New here?" })).toHaveCount(0);
    // Account creation, opened from there, goes back to Join, and Join to the list.
    await page.getByRole("button", { name: "Manage your own keys", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Prove you’re not a robot." })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", START_HEADING)).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(identityList(page).getByRole("button")).toHaveCount(2);
  });

  test("Cancel on the list answers the app", async ({ page }) => {
    await page.route("https://notes.example/**", (route) =>
      route.fulfill({ body: "<!doctype html><title>Returned</title>", contentType: "text/html" }),
    );
    await seedIdentities(page);
    await openRequest(page);
    await expect(identityList(page).getByRole("button")).toHaveCount(2);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL("https://notes.example/cancel");
  });
});

test.describe("a long list in the popup", () => {
  test.use({ viewport: POPUP });

  test("shows how many identities it lists, every row in the page's flow, and no Ring identity", async ({
    page,
  }) => {
    await page.goto("/");
    const many: SeededIdentity[] = MANY_KEYS.map((publicKeyZ32, index) => ({
      publicKeyZ32,
      googleAccount: {
        googleSubject: `google-${index}`,
        name: `Person ${index}`,
        email: `person-${index}@example.com`,
        pictureUrl: null,
      },
    }));
    await storeLocalIdentities(page, many, { active: MANY_KEYS[0]! });
    await page.evaluate((key) => {
      localStorage.setItem(
        `pubky-passport/local-identities/v1/identity/${key}`,
        JSON.stringify({ v: 1, publicKeyZ32: key, keySource: "ring" }),
      );
    }, RING_KEY);
    await openRequest(page);

    // Ten with a key in this browser; the saved Ring identity is neither listed nor counted.
    await expect(page.getByText("10 identities", { exact: true })).toBeVisible();
    const list = identityList(page);
    await expect(list.getByRole("button")).toHaveCount(10);
    await expect(page.getByText("Key in Pubky Ring", { exact: true })).toHaveCount(0);
    // The page scrolls as a whole: the list holds every row, and the other ways in follow it.
    const layout = await list.evaluate((node) => ({
      scrolls: node.scrollHeight > node.clientHeight + 1,
      listBottom: node.getBoundingClientRect().bottom,
      pageHeight: document.documentElement.scrollHeight,
    }));
    expect(layout.scrolls).toBe(false);
    expect(layout.pageHeight).toBeGreaterThan(POPUP.height);
    const [another] = await bottoms(page, ["Use another identity"]);
    expect(another).toBeGreaterThan(layout.listBottom);
    // Tabbing past the last row reaches them.
    await list.getByRole("button").last().focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Use another identity" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Use another identity" })).toBeInViewport();
  });
});

test.describe("reading profiles", () => {
  test.use({ viewport: POPUP });

  test("the list reads no profile; it names identities from earlier reads", async ({ page }) => {
    await mockPublicProfile(page, {
      name: "Satoshi",
      image: `pubky://${PROFILE_KEY}/pub/pubky.app/files/AVATAR`,
    });
    const relayReads: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (PKARR_RELAY_HOSTS.has(url.hostname)) relayReads.push(url.pathname.slice(1));
    });
    await page.goto("/");
    // `PROFILE_KEY` has a published profile; `GOOGLE_KEY` has none.
    await storeLocalIdentities(
      page,
      [{ publicKeyZ32: PROFILE_KEY }, { publicKeyZ32: GOOGLE_KEY }],
      {
        active: PROFILE_KEY,
      },
    );
    // The overview reads the active identity, and Passport keeps its name and a small avatar.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Satoshi", exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) =>
            localStorage.getItem(`pubky-passport/local-identities/v1/profile-summary/${key}`),
          PROFILE_KEY,
        ),
      )
      .toMatch(/"name":"Satoshi","avatar":"data:image\/jpeg;base64,/u);

    relayReads.length = 0;
    await openRequest(page);
    const remembered = identityList(page).getByRole("button", { name: /Satoshi/u });
    await expect(remembered).toBeVisible();
    await expect(remembered.locator('img[src^="data:image/jpeg"]')).toBeVisible();
    await page.waitForTimeout(1_000);
    // Opening the request resolved no identity: nothing links the saved identities together.
    expect(relayReads).toEqual([]);

    await identityList(page)
      .getByRole("button", { name: /1aeh…dwdy/u })
      .click();
    await expect(page.getByRole("heading", { name: "Requested permissions" })).toBeVisible();
    await expect.poll(() => relayReads.length).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    // Only the identity chosen for the review is resolved.
    expect(new Set(relayReads)).toEqual(new Set([GOOGLE_KEY]));
  });
});

test.describe("a computer's fine pointer", () => {
  test.use({ viewport: POPUP, hasTouch: false });

  test("shows the Pubky Ring QR code at once and follows no link", async ({ page }) => {
    const handoffs = recordHandoffs(page);
    await openRequest(page);
    expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);

    await page.getByRole("button", { name: RING, exact: true }).click();

    await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    await expect(page.getByText(/Scan this code with Pubky Ring on your phone/u)).toBeVisible();
    await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveCount(0);
    // Nothing to report: Back is the screen's only control, and it fits.
    await expect(page.getByRole("button", { name: /approved|Back to /u })).toHaveCount(0);
    for (const bottom of await bottoms(page, ["Back"]))
      expect(bottom).toBeLessThanOrEqual(POPUP.height);
    expect(handoffs).toEqual([]);
  });

  test("flags a request for all data on Join, whose keychain line skips the review, and beside the Pubky Ring code", async ({
    page,
  }) => {
    await page.goto(`/authorize#d=${encodeURIComponent(BROAD_REQUEST)}`);
    const warning = page
      .locator("main")
      .getByRole("alert")
      .filter({ hasText: "This app asks for access to all your data, public and private." });
    // The keychain line hands the request on without its review (a phone opens the app from the
    // press), so Join flags it first, above the cards; the hand-off flags it again.
    await expect(page.getByRole("heading", START_HEADING)).toBeVisible();
    await expect(warning).toBeVisible();
    const line = page.getByRole("button", { name: RING, exact: true });
    expect((await warning.boundingBox())!.y).toBeLessThan((await line.boundingBox())!.y);

    await line.click();
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    await expect(warning).toBeVisible();
  });
});

test.describe("a phone's coarse pointer", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("from the review, Continue with keychain hands the request over unchanged", async ({
    page,
  }) => {
    await page.goto("/");
    await storeLocalIdentities(page, [{ publicKeyZ32: PLAIN_KEY }], { active: PLAIN_KEY });
    await openRequest(page);
    const authorize = page.getByRole("button", { name: "Authorize", exact: true });
    await expect(authorize).toBeVisible();

    // The app's legacy request goes to Pubky Ring, the one keychain app that approves it.
    await page.getByRole("button", { name: KEYCHAIN, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    // The link Ring opens is the app's request, byte for byte.
    await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveAttribute("href", REQUEST);
    // Back returns to the review; nothing was approved in Passport.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(authorize).toBeVisible();
  });

  test("follows the deep link from the press and keeps one button, never a QR code", async ({
    page,
    browserName,
  }) => {
    const qrSeen = await watchForQrCodes(page);
    const handoffs = recordHandoffs(page);
    // Opening an app must not ask whether to leave the page.
    const prompts: string[] = [];
    page.on("dialog", (dialog) => {
      prompts.push(dialog.type());
      void dialog.dismiss();
    });
    await openRequest(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

    await page.getByRole("button", { name: RING, exact: true }).click();

    await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    // Firefox reports no request for a navigation to another app's scheme.
    if (browserName !== "firefox") await expect.poll(() => handoffs).toEqual([REQUEST]);
    const button = page.locator('main a[href^="pubkyauth:"]');
    await expect(button).toHaveAccessibleName("Opening Pubky Ring…");
    const box = await button.boundingBox();
    // Passport waits for the app to take Ring's answer, with no line saying so.
    await expect(page.getByText(/Waiting for|continues by itself/u)).toHaveCount(0);
    const back = page.getByRole("button", { name: "Back", exact: true });
    const backBox = await back.boundingBox();
    // Nothing to report: the Ring hand-off has no button for an approval.
    await expect(page.getByRole("button", { name: /approved|Back to /u })).toHaveCount(0);

    // No app took over the page. The same button, in the same place, offers another try with the
    // same request; no code, no second layout, nothing else moves.
    await page.waitForTimeout(2_500);
    await expect(button).toHaveAccessibleName("Open Pubky Ring");
    await expect(button).toHaveAttribute("href", REQUEST);
    expect(await button.boundingBox()).toEqual(box);
    expect(await back.boundingBox()).toEqual(backBox);
    await expect(page.getByText(/didn't open|another phone|Scan this code/u)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /QR code/u })).toHaveCount(0);
    expect(await qrSeen()).toBe(0);
    expect(prompts).toEqual([]);
  });

  test("keeps the same button when the page comes back from Pubky Ring, and a re-press reuses the request", async ({
    page,
    browserName,
  }) => {
    const qrSeen = await watchForQrCodes(page);
    const handoffs = recordHandoffs(page);
    await openRequest(page);
    await page.getByRole("button", { name: RING, exact: true }).click();
    const button = page.locator('main a[href^="pubkyauth:"]');
    await expect(button).toHaveAccessibleName("Opening Pubky Ring…");
    const box = await button.boundingBox();
    // The app opening hides the page; coming back finds the hand-off exactly where it was.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(button).toHaveAccessibleName("Open Pubky Ring");
    await page.waitForTimeout(2_500);
    expect(await button.boundingBox()).toEqual(box);
    await expect(page.getByRole("button", { name: /QR code/u })).toHaveCount(0);
    expect(await qrSeen()).toBe(0);

    // Pressing it again opens Ring with the same request: no second one is made.
    await button.click();
    await expect(button).toHaveAttribute("href", REQUEST);
    if (browserName !== "firefox") await expect.poll(() => handoffs).toEqual([REQUEST, REQUEST]);
    expect(await qrSeen()).toBe(0);
  });
});

/**
 * Counts every QR code that ever enters the page, however briefly, so a flash between two renders
 * is caught as well as one that stays.
 */
async function watchForQrCodes(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    let seen = 0;
    Object.defineProperty(window, "__qrSeen", { get: () => seen });
    const count = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches('[aria-label$="QR code"]')) seen++;
      seen += node.querySelectorAll('[aria-label$="QR code"]').length;
    };
    new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(count);
    }).observe(document, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as Window & { __qrSeen?: number }).__qrSeen ?? 0);
}
