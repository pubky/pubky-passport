import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { APPLE_PORT } from "../playwright.config";
import { installFakeApple } from "./support/fakeApple";

/**
 * Every app screen is one 375px column (24px padding each side, so 327px of content), at every
 * width; only the Terms and Privacy pages keep their wider reading layout. Dialogs are at most
 * 375px wide, provider windows open 390px wide, and the sign-in screens end with the Synonym badge
 * under the Terms notice instead of the footer.
 */

const APPLE_ORIGIN = `http://127.0.0.1:${APPLE_PORT}`;
const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const REQUEST = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client&x-cancel=https%3A%2F%2Fclient.example%2Fcancel`;
const AUTHORIZE = `/authorize#d=${encodeURIComponent(REQUEST)}`;
const COLUMN = 375;
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];

async function seedIdentity(page: Page) {
  await page.addInitScript(
    ({ publicKey, root }) => {
      localStorage.setItem(
        `${root}/identity/${publicKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: publicKey,
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
          googleAccount: {
            googleSubject: "google-First",
            email: "First@example.com",
            name: "First",
            pictureUrl: null,
          },
        }),
      );
      localStorage.setItem(`${root}/active`, publicKey);
    },
    { publicKey: PUBLIC_KEY, root: STORAGE_ROOT },
  );
}

/**
 * The screen's `<main>` is min(viewport, 375) wide and centred, nothing inside it is wider than
 * its 24px-padded content box, and the page never scrolls sideways.
 */
async function expectColumn(page: Page, viewportWidth: number) {
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
  const geometry = await main.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const left = box.left + parseFloat(style.paddingLeft);
    const right = box.right - parseFloat(style.paddingRight);
    const overflowing = [...element.querySelectorAll<HTMLElement>("*")]
      .filter((node) => !node.closest("dialog, .sr-only") && node.getClientRects().length > 0)
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < left - 0.5 || rect.right > right + 0.5))
      .map(({ node, rect }) => `${node.tagName}.${node.className} ${rect.left}-${rect.right}`);
    return {
      x: box.x,
      width: box.width,
      paddingLeft: parseFloat(style.paddingLeft),
      paddingRight: parseFloat(style.paddingRight),
      overflowing,
      pageScrollWidth: document.documentElement.scrollWidth,
    };
  });
  const expected = Math.min(viewportWidth, COLUMN);
  expect(Math.abs(geometry.width - expected)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.x - (viewportWidth - expected) / 2)).toBeLessThanOrEqual(0.5);
  expect(geometry.paddingLeft).toBe(24);
  expect(geometry.paddingRight).toBe(24);
  expect(geometry.overflowing).toEqual([]);
  expect(geometry.pageScrollWidth).toBeLessThanOrEqual(viewportWidth);
}

function back(page: Page): Locator {
  return page.getByRole("button", { name: "Back", exact: true });
}

/** A full-width action is exactly the column's content width (327px at 375 and above). */
async function expectContentWidth(locator: Locator, viewportWidth: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.width ?? 0) - (Math.min(viewportWidth, COLUMN) - 48))).toBeLessThanOrEqual(
    0.5,
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
    });

    test("sign-in screens are one 375px column with 327px pills", async ({ page }) => {
      for (const url of ["/", `${APPLE_ORIGIN}/`, `${APPLE_ORIGIN}${AUTHORIZE}`]) {
        await page.goto(url);
        const google = page.getByRole("button", { name: "Continue with Google" });
        await expect(google).toBeVisible();
        await expectColumn(page, viewport.width);
        // The pill row (pill plus its help control) spans the content box.
        await expectContentWidth(google.locator("xpath=.."), viewport.width);
      }
    });

    test("manual authorization is one 375px column", async ({ page }) => {
      await page.goto("/authorize");
      await expect(page.getByRole("heading", { name: "Authorize a service." })).toBeVisible();
      await expectColumn(page, viewport.width);
    });

    test("dashboard and management screens are one 375px column", async ({ page }) => {
      await seedIdentity(page);
      await page.goto("/");
      await expect(page.getByText("First@example.com", { exact: true })).toBeVisible();
      await expectColumn(page, viewport.width);

      await page.getByRole("button", { name: "Manage", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
      await expectColumn(page, viewport.width);
      await expectContentWidth(back(page), viewport.width);

      await page.getByRole("button", { name: "Backup", exact: true }).click();
      await expect(page.getByLabel("Enter strong password")).toBeVisible();
      await expectColumn(page, viewport.width);
      await expectContentWidth(back(page), viewport.width);
      await back(page).click();

      await page.getByRole("button", { name: "Keychain", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Migrate to keychain." })).toBeVisible();
      await expectColumn(page, viewport.width);
      await back(page).click();

      await page.getByRole("button", { name: "Detach from Google", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Backup your pubky first." })).toBeVisible();
      await expectColumn(page, viewport.width);
      await page.getByRole("button", { name: "I backed up my pubky" }).click();
      await expect(page.getByRole("heading", { name: "Detach from Google." })).toBeVisible();
      await expectColumn(page, viewport.width);
      await back(page).click();
      await back(page).click();
      await back(page).click();

      await page.getByRole("button", { name: "Switch", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Switch identity." })).toBeVisible();
      await expectColumn(page, viewport.width);
      await expectContentWidth(back(page), viewport.width);
    });

    test("authorization review is one 375px column", async ({ page }) => {
      await seedIdentity(page);
      await page.goto(AUTHORIZE);
      await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
      await expectColumn(page, viewport.width);
    });

    test("the Terms of Service page keeps its reading layout", async ({ page }) => {
      await page.goto("/terms-of-service");
      const main = page.getByRole("main");
      await expect(main).toBeVisible();
      const width = (await main.boundingBox())?.width ?? 0;
      if (viewport.width >= 1024) expect(width).toBeGreaterThan(COLUMN);
      else expect(Math.abs(width - viewport.width)).toBeLessThanOrEqual(0.5);
      await expect(page.getByRole("contentinfo")).toBeVisible();
    });

    test("sign-in screens end with the Synonym badge under the notice and no footer", async ({
      page,
    }) => {
      for (const url of ["/", `${APPLE_ORIGIN}/`, `${APPLE_ORIGIN}${AUTHORIZE}`]) {
        await page.goto(url);
        await expectBadgeUnderNotice(page);
      }
    });

    test("Add identity and Use other identity end with the badge too", async ({ page }) => {
      await seedIdentity(page);
      await page.goto(`${APPLE_ORIGIN}/`);
      await page.getByRole("button", { name: "Switch", exact: true }).click();
      await page.getByRole("button", { name: "Add identity" }).click();
      await expectBadgeUnderNotice(page);
      await expectColumn(page, viewport.width);

      await page.goto(`${APPLE_ORIGIN}${AUTHORIZE}`);
      await page.getByRole("button", { name: "Switch", exact: true }).click();
      await page.getByRole("button", { name: "Use other identity" }).click();
      await expectBadgeUnderNotice(page);
    });
  });
}

/** The badge sits right under the notice, above the illustration; the footer is gone. */
async function expectBadgeUnderNotice(page: Page) {
  const notice = page.locator("[data-passport-sign-in-notice]");
  await expect(notice).toBeVisible();
  const badge = page.getByRole("main").getByRole("img", { name: "Synonym, a Tether company" });
  await expect(badge).toHaveCount(1);
  await expect(badge).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeHidden();
  await expect(page.getByRole("img", { name: "Synonym, a Tether company" })).toHaveCount(1);
  await expect(page.locator("p:visible", { hasText: "powered by the Pubky protocol" })).toHaveCount(
    1,
  );
  const [noticeBox, badgeBox] = await Promise.all([notice.boundingBox(), badge.boundingBox()]);
  expect(noticeBox).not.toBeNull();
  expect(badgeBox).not.toBeNull();
  const gap = (badgeBox?.y ?? 0) - ((noticeBox?.y ?? 0) + (noticeBox?.height ?? 0));
  expect(gap).toBeGreaterThanOrEqual(8);
  expect(gap).toBeLessThanOrEqual(24);
  expect(Math.abs((badgeBox?.x ?? 0) - (noticeBox?.x ?? 0))).toBeLessThanOrEqual(0.5);
  const illustration = page.locator('main img[src*="cloud"]');
  const illustrationBox = await illustration.boundingBox();
  expect(illustrationBox).not.toBeNull();
  expect(illustrationBox?.y ?? 0).toBeGreaterThanOrEqual(
    (badgeBox?.y ?? 0) + (badgeBox?.height ?? 0),
  );
}

test("pages without the sign-in notice keep the footer and its badge", async ({ page }) => {
  await seedIdentity(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const url of ["/", "/authorize", "/terms-of-service"]) {
      await page.goto(url);
      await expect(page.getByRole("main")).toBeVisible();
      const footer = page.getByRole("contentinfo");
      await expect(footer).toBeVisible();
      await expect(footer.getByRole("link", { name: "Terms of Service" })).toBeVisible();
      await expect(footer.getByRole("img", { name: "Synonym, a Tether company" })).toBeVisible();
      await expect(page.locator("[data-passport-sign-in-notice]")).toHaveCount(0);
    }
  }
});

test.describe("dialogs at 1280", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  async function expectDialogWidth(dialog: Locator) {
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? Infinity).toBeLessThanOrEqual(COLUMN);
    // Centred on the page.
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - 640)).toBeLessThanOrEqual(1);
  }

  test("the provider help drawer is at most 375px", async ({ context, page }) => {
    await installFakeApple(context);
    await page.goto(`${APPLE_ORIGIN}/`);
    for (const name of ["How Google sign-in works", "How Apple sign-in works", "How?"]) {
      await page.getByRole("button", { name }).click();
      await expectDialogWidth(page.getByRole("dialog"));
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("the QR scanner is at most 375px", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException("Mocked denial", "NotAllowedError")),
        },
      });
    });
    await page.goto("/authorize");
    await page.getByRole("button", { name: "Scan QR", exact: true }).click();
    await expectDialogWidth(page.getByRole("dialog", { name: "Scan QR code" }));
  });

  test("the detach confirmation is at most 375px", async ({ page }) => {
    await seedIdentity(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await page.getByRole("button", { name: "Detach from Google", exact: true }).click();
    await page.getByRole("button", { name: "I backed up my pubky" }).click();
    await page.getByRole("button", { name: "Remove Google Access" }).click();
    await expectDialogWidth(page.getByRole("dialog"));
  });
});

/** Records the features string of every window.open on the page. */
async function recordWindowFeatures(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const features: string[] = [];
    Object.defineProperty(window, "__passportOpenFeatures", { value: features });
    const open = window.open.bind(window);
    window.open = (url?: string | URL, target?: string, feature?: string) => {
      features.push(feature ?? "");
      return open(url, target, feature);
    };
  });
}

function openedFeatures(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as Window & { __passportOpenFeatures?: string[] }).__passportOpenFeatures ?? [],
  );
}

// iCloud's own window (when Apple's has closed) is covered by ICloudConnection's unit test.
test("Google and Apple windows open 390px wide", async ({ context, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installFakeApple(context, { holdApple: true });
  await context.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Google</h1>" }),
  );
  await recordWindowFeatures(context);

  for (const provider of ["Google", "Apple"]) {
    await page.goto(`${APPLE_ORIGIN}/`);
    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: `Continue with ${provider}`, exact: true }).click();
    await popup;
    expect(await openedFeatures(page)).toEqual(["popup,width=390,height=700"]);
    await (await popup).close();
  }
});
