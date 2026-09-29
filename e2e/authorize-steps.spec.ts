import { storeLocalIdentities, type SeededIdentity } from "./helpers/localIdentities";
import { PKARR_RELAY_HOSTS } from "./helpers/network";
import { expect, test, type Page } from "./helpers/passportTest";
import { mockPublicProfile, PROFILE_KEY } from "./helpers/pubkyProfile";

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
/** The list's bottom fade, over which a row reads as more to scroll to. */
const LIST_FADE_PX = 32;

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
  // A Ring-held identity has no secret key in the browser.
  await page.evaluate((key) => {
    localStorage.setItem(
      `pubky-passport/local-identities/v1/identity/${key}`,
      JSON.stringify({ v: 1, publicKeyZ32: key, keySource: "ring" }),
    );
  }, RING_KEY);
}

async function openRequest(page: Page) {
  await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
  await expect(page.getByRole("heading", { name: "Sign in to Acme Notes" })).toBeVisible();
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

  test("lists every identity to fill the popup, then reviews the one chosen", async ({ page }) => {
    await seedIdentities(page);
    await openRequest(page);

    const rows = identityList(page).getByRole("button");
    await expect(rows).toHaveCount(3);
    // The identity used last comes first, and a Ring-held identity says where its key is, in
    // view above the list's fade.
    await expect(rows.first()).toContainText("work@example.com");
    const ringRow = (await page.getByRole("button", { name: /Key in Pubky Ring/u }).boundingBox())!;
    const listBox = (await identityList(page).boundingBox())!;
    expect(ringRow.y + ringRow.height).toBeLessThanOrEqual(
      listBox.y + listBox.height - LIST_FADE_PX,
    );
    await expect(page.getByText("or", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
    // The screen fills the popup below the header; the other ways in stay in view at its bottom.
    const layout = await page.evaluate(() => ({
      mainBottom: document.querySelector("main")!.getBoundingClientRect().bottom,
      footerTop: document.querySelector("body > footer")!.getBoundingClientRect().top,
      width: document.documentElement.scrollWidth,
    }));
    expect(Math.abs(layout.mainBottom - POPUP.height)).toBeLessThanOrEqual(1);
    expect(layout.footerTop).toBeGreaterThanOrEqual(POPUP.height - 1);
    expect(layout.width).toBeLessThanOrEqual(POPUP.width);
    for (const bottom of await bottoms(page, ["Use another identity", "Continue with Pubky Ring"]))
      expect(bottom).toBeLessThanOrEqual(POPUP.height);

    await page.getByRole("button", { name: /tkrq…p7qy/u }).click();
    const selected = page.getByRole("region", { name: "Selected identity" });
    // The key keeps its own case in the review, as in the list.
    await expect(selected).toContainText("Pubky tkrq…p7qy");
    await expect(page.getByRole("list", { name: "Requested permissions" })).toBeVisible();
    // The primary action stays in view in the popup, beside Cancel.
    const [cancel, authorize] = await bottoms(page, ["Cancel", "Authorize"]);
    expect(authorize).toBeLessThanOrEqual(POPUP.height);
    expect(cancel).toBe(authorize);

    await page.getByRole("button", { name: "Switch identity", exact: true }).click();
    await expect(identityList(page).getByRole("button")).toHaveCount(3);
    await expect(identityList(page).getByRole("button").first()).toContainText("tkrq…p7qy");
  });

  test("with no identity, shows the start page and Pubky Ring below an or", async ({ page }) => {
    await openRequest(page);

    await expect(identityList(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use another identity" })).toHaveCount(0);
    const create = page.getByRole("button", { name: "Create account", exact: true });
    const ring = page.getByRole("button", { name: "Continue with Pubky Ring", exact: true });
    // The start page's cards, with Create account as the recommended way in.
    await expect(page.getByRole("button", { name: "Import recovery file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(await create.evaluate((button) => getComputedStyle(button).borderColor)).toBe(
      "rgb(200, 255, 0)",
    );
    // Pubky Ring answers the waiting app, below an "or" after the cards.
    const or = page.getByText("or", { exact: true });
    await expect(or).toBeVisible();
    expect((await or.boundingBox())!.y).toBeGreaterThan((await create.boundingBox())!.y);
    expect((await ring.boundingBox())!.y).toBeGreaterThan((await or.boundingBox())!.y);
    expect(await ring.evaluate((button) => getComputedStyle(button).borderColor)).not.toBe(
      "rgb(200, 255, 0)",
    );
    await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
    // The popup opens with Cancel and the recommended way in on screen. Both cards do not fit
    // above the fold at 520x760, so Pubky Ring may sit below it but is reached by scrolling.
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
    const [createBottom, ringBottom] = await bottoms(page, [
      "Create account",
      "Continue with Pubky Ring",
    ]);
    expect(createBottom).toBeLessThanOrEqual(POPUP.height);
    if (ringBottom! > POPUP.height) {
      await ring.scrollIntoViewIfNeeded();
      await expect(ring).toBeInViewport({ ratio: 1 });
    }

    await create.click();
    await expect(page.getByRole("heading", { name: "Create your account." })).toBeVisible();
    await expect(page.getByLabel("Signing in to notes.example")).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in to Acme Notes" })).toBeVisible();
    await expect(ring).toBeVisible();
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
    // Still addressed to the waiting app, with every way in.
    await expect(page.getByRole("heading", { name: "Sign in to Acme Notes" })).toBeVisible();
    for (const name of [
      "Create account",
      "Import recovery file",
      "Continue with Google",
      "Continue with Pubky Ring",
    ])
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(identityList(page).getByRole("button")).toHaveCount(3);
  });

  test("Cancel on the list answers the app", async ({ page }) => {
    await page.route("https://notes.example/**", (route) =>
      route.fulfill({ body: "<!doctype html><title>Returned</title>", contentType: "text/html" }),
    );
    await openRequest(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL("https://notes.example/cancel");
  });
});

test.describe("a long list in the popup", () => {
  test.use({ viewport: POPUP });

  test("shows how many identities there are, a clear part of the next row, and the Ring label", async ({
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

    await expect(page.getByText("11 identities", { exact: true })).toBeVisible();
    const list = identityList(page);
    const listBox = (await list.boundingBox())!;
    const clearBottom = listBox.y + listBox.height - LIST_FADE_PX;
    const rows = await list.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, text: button.textContent ?? "" };
      }),
    );
    // Whole rows above the fade, then at least a third of the next one.
    const cut = rows.find((row) => row.bottom > clearBottom)!;
    expect(rows.indexOf(cut)).toBeGreaterThanOrEqual(2);
    expect(clearBottom - cut.top).toBeGreaterThanOrEqual((cut.bottom - cut.top) / 3);
    for (const bottom of await bottoms(page, ["Use another identity", "Continue with Pubky Ring"]))
      expect(bottom).toBeLessThanOrEqual(POPUP.height);

    // Moving through the list by keyboard keeps the focused row clear of the fade.
    await list.getByRole("button").first().focus();
    for (let step = 0; step < 3; step++) await page.keyboard.press("Tab");
    const focused = (await list.locator("button:focus").boundingBox())!;
    expect(focused.y + focused.height).toBeLessThanOrEqual(clearBottom + 1);
    expect(focused.y).toBeGreaterThanOrEqual(listBox.y);
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
    await expect(page.getByRole("list", { name: "Requested permissions" })).toBeVisible();
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

    await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    await expect(page.getByText(/Scan this code with Pubky Ring on your phone/u)).toBeVisible();
    await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveCount(0);
    for (const bottom of await bottoms(page, ["Back", "I approved in Pubky Ring"]))
      expect(bottom).toBeLessThanOrEqual(POPUP.height);
    expect(handoffs).toEqual([]);
  });

  test("flags a request for all data before it can go to Pubky Ring", async ({ page }) => {
    await page.goto(`/authorize#d=${encodeURIComponent(BROAD_REQUEST)}`);
    const warning = page
      .locator("main")
      .getByRole("alert")
      .filter({ hasText: "This app asks for access to all your data, public and private." });
    await expect(warning).toBeVisible();

    await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    await expect(warning).toBeVisible();
  });
});

test.describe("a phone's coarse pointer", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("follows the deep link, then shows the QR code once the page stays in view", async ({
    page,
    browserName,
  }) => {
    const handoffs = recordHandoffs(page);
    // Opening an app must not ask whether to leave the page.
    const prompts: string[] = [];
    page.on("dialog", (dialog) => {
      prompts.push(dialog.type());
      void dialog.dismiss();
    });
    await openRequest(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

    const pressed = Date.now();
    await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    // Firefox reports no request for a navigation to another app's scheme.
    if (browserName !== "firefox") await expect.poll(() => handoffs).toEqual([REQUEST]);
    await expect(page.getByRole("link", { name: "Opening Pubky Ring…" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
    // Nothing can be approved while Ring opens, so "I approved" is not a second brand action.
    const approved = page.getByRole("button", { name: "I approved in Pubky Ring" });
    await expect(approved).not.toHaveCSS("border-color", "rgb(200, 255, 0)");
    // No app took over the page, so the QR code takes over after about two seconds.
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    expect(Date.now() - pressed).toBeGreaterThanOrEqual(1_500);
    await expect(page.getByText(/Pubky Ring didn't open on this device/u)).toBeVisible();
    await expect(page.getByText(/Scan this code with Pubky Ring on another phone/u)).toBeVisible();
    await expect(approved).toHaveCSS("border-color", "rgb(200, 255, 0)");
    await expect(page.getByRole("link", { name: "Open Pubky Ring" })).toHaveAttribute(
      "href",
      REQUEST,
    );
    expect(prompts).toEqual([]);
  });

  test("keeps the QR code behind a toggle when Pubky Ring took over the page", async ({ page }) => {
    await openRequest(page);
    await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
    await expect(page.getByRole("link", { name: "Opening Pubky Ring…" })).toBeVisible();
    // The app opening hides the page; coming back finds the hand-off where it was.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("link", { name: "Open Pubky Ring" })).toBeVisible();
    await page.waitForTimeout(2_500);
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show QR code" }).click();
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
  });
});
