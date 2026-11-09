import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { APPLE_PORT } from "../playwright.config";
import { APPLE_AUTHORIZE, installFakeApple } from "./support/fakeApple";

/** Passport with Apple login on; the default server has it off. */
const APPLE_ORIGIN = `http://127.0.0.1:${APPLE_PORT}`;
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const REQUEST = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client&x-cancel=https%3A%2F%2Fclient.example%2Fcancel`;
const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const GOOGLE_KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
const CHOICE = "Choose an account to sign in with";

function authorizeUrl(origin: string, extraFragment = ""): string {
  return `${origin}/authorize#d=${encodeURIComponent(REQUEST)}${extraFragment}`;
}

/** Records every navigation to Google's authorize endpoint and answers with a stub page. */
async function fakeGoogle(context: BrowserContext): Promise<URL[]> {
  const requests: URL[] = [];
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
    requests.push(new URL(route.request().url()));
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Google</h1>" });
  });
  return requests;
}

/** Counts windows Passport opens, so a test can prove nothing opened without a click. */
function countPopups(page: Page): { readonly count: number } {
  const popups = { count: 0 };
  page.on("popup", () => {
    popups.count += 1;
  });
  return popups;
}

/** Both provider buttons: same size, Google above Apple, inside one labelled group. */
async function expectProviderChoice(page: Page): Promise<{ apple: Locator; google: Locator }> {
  const choice = page.getByRole("group", { name: CHOICE });
  await expect(choice).toBeVisible();
  await expect(choice.getByText(CHOICE)).toHaveCount(0);
  const apple = choice.getByRole("button", { name: "Continue with Apple" });
  const google = choice.getByRole("button", { name: "Continue with Google" });
  await expect(apple).toBeEnabled();
  await expect(google).toBeEnabled();
  const [appleBox, googleBox] = await Promise.all([apple.boundingBox(), google.boundingBox()]);
  expect(appleBox).not.toBeNull();
  expect(googleBox).not.toBeNull();
  expect(Math.abs((appleBox?.width ?? 0) - (googleBox?.width ?? -10))).toBeLessThanOrEqual(1);
  expect(Math.abs((appleBox?.height ?? 0) - (googleBox?.height ?? -10))).toBeLessThanOrEqual(1);
  expect(Math.round(googleBox?.height ?? 0)).toBe(60);
  expect((googleBox?.y ?? Infinity) + (googleBox?.height ?? 0)).toBeLessThanOrEqual(
    appleBox?.y ?? 0,
  );
  // Apple's title keeps at least 8% of the button's width free on its right.
  const titleRight = await apple.getByText("Continue with Apple").evaluate((title) => {
    const range = document.createRange();
    range.selectNodeContents(title);
    return range.getBoundingClientRect().right;
  });
  expect((appleBox?.x ?? 0) + (appleBox?.width ?? 0) - titleRight).toBeGreaterThanOrEqual(
    (appleBox?.width ?? 0) * 0.08,
  );
  return { apple, google };
}

async function installGoogleIdentity(page: Page) {
  await page.addInitScript(
    ({ root, key }) => {
      localStorage.setItem(
        `${root}/identity/${key}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: key,
          googleAccount: {
            googleSubject: "google-e2e",
            email: "google-user@example.com",
            name: "Google User",
            pictureUrl: null,
          },
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        }),
      );
      localStorage.setItem(`${root}/active`, key);
    },
    { root: STORAGE_ROOT, key: GOOGLE_KEY },
  );
}

test.describe("with Apple login on", () => {
  test("the start page offers Apple and Google as one choice", async ({ context, page }) => {
    await installFakeApple(context);
    const google = await fakeGoogle(context);

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${APPLE_ORIGIN}/`);
      await expectProviderChoice(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    }
    expect(google).toHaveLength(0);
  });

  test("Continue with Google is Google's Light button in Google Sans", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    await page.goto(`${APPLE_ORIGIN}/`);
    const { google } = await expectProviderChoice(page);

    const style = await google.evaluate(async (button) => {
      const computed = getComputedStyle(button);
      await document.fonts.load(`500 ${computed.fontSize} "Google Sans"`);
      return {
        background: computed.backgroundColor,
        border: `${computed.borderTopWidth} ${computed.borderTopStyle} ${computed.borderTopColor}`,
        color: computed.color,
        family: computed.fontFamily.replaceAll('"', ""),
        size: Number.parseFloat(computed.fontSize),
        weight: computed.fontWeight,
        googleSansLoaded: [...document.fonts].some(
          (face) =>
            face.family.replaceAll('"', "") === "Google Sans" &&
            face.weight === "500" &&
            face.status === "loaded",
        ),
      };
    });
    expect(style).toEqual({
      background: "rgb(255, 255, 255)",
      border: "1px solid rgb(116, 119, 117)",
      color: "rgb(31, 31, 31)",
      family: "Google Sans, Roboto, Arial, sans-serif",
      size: expect.closeTo(21, 1),
      weight: "500",
      googleSansLoaded: true,
    });
    // Google's "G" inside the button, at 18/40 of its height.
    await expect(google.locator("img[src='/brand/google-sign-in-g.png']")).toHaveCount(1);
    const logoBox = await google.locator("img").boundingBox();
    expect(logoBox?.height).toBeCloseTo(60 * (20 / 40), 1);
  });

  test("an authorization without an identity waits for the person to pick", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    const google = await fakeGoogle(context);
    await context.route("https://client.example/cancel", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Cancelled</h1>" }),
    );
    const popups = countPopups(page);

    await page.goto(authorizeUrl(APPLE_ORIGIN));

    await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
    await expectProviderChoice(page);
    expect(page.url()).toBe(`${APPLE_ORIGIN}/authorize`);
    expect(google).toHaveLength(0);
    expect(popups.count).toBe(0);

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible();
  });

  test("Continue with Google goes to Google in the same tab and resumes on its return", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    const requests: URL[] = [];
    // Google answers by redirecting back to Passport's root with tokens in the fragment.
    await context.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
      const request = new URL(route.request().url());
      requests.push(request);
      const response = new URL(request.searchParams.get("redirect_uri")!);
      const claims = Buffer.from(
        JSON.stringify({ sub: "google-choice-user", nonce: request.searchParams.get("nonce") }),
      ).toString("base64url");
      response.hash = new URLSearchParams({
        state: request.searchParams.get("state")!,
        access_token: "choice-access-canary",
        id_token: `header.${claims}.signature`,
        scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
        expires_in: "3600",
      }).toString();
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><script>location.replace(${JSON.stringify(response.href)})</script>`,
      });
    });
    await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
      route.fulfill({
        json: { sub: "google-choice-user", email: "test@example.com", name: "Test" },
      }),
    );
    await context.route("https://www.googleapis.com/drive/v3/files**", (route) =>
      route.fulfill({ json: { files: [] } }),
    );
    const popups = countPopups(page);

    await page.goto(authorizeUrl(APPLE_ORIGIN));
    const { google: continueWithGoogle } = await expectProviderChoice(page);
    expect(requests).toHaveLength(0);
    await continueWithGoogle.click();

    // Back from Google, setup carries on without showing the choice again.
    await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
    await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
    await expect(page.getByRole("group", { name: CHOICE })).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.href).not.toContain(SECRET);
    expect(popups.count).toBe(0);
  });

  test("Continue with Apple opens Apple's window from the click, then reuses it for iCloud", async ({
    context,
    page,
  }) => {
    const apple = await installFakeApple(context, { holdICloud: true });
    const google = await fakeGoogle(context);
    const popups = countPopups(page);

    await page.goto(authorizeUrl(APPLE_ORIGIN));
    const { apple: continueWithApple } = await expectProviderChoice(page);
    expect(
      apple.requests.filter((request) => request.url().startsWith(`${APPLE_AUTHORIZE}?`)),
    ).toHaveLength(0);

    const applePopup = page.waitForEvent("popup");
    await continueWithApple.click();
    await applePopup;
    await expect(page.getByRole("heading", { name: "Finish in Apple's window." })).toBeVisible();
    await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
    expect(
      apple.requests.filter((request) => request.url().startsWith(`${APPLE_AUTHORIZE}?`)),
    ).toHaveLength(1);
    expect(popups.count).toBe(1);
    expect(google).toHaveLength(0);
  });

  test("someone with a Google identity can still pick Apple from Switch", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    const google = await fakeGoogle(context);
    await installGoogleIdentity(page);

    await page.goto(authorizeUrl(APPLE_ORIGIN));
    await expect(page.getByRole("heading", { name: "Sign in to Client" })).toBeVisible();
    await expect(page.getByText("Google User")).toBeVisible();

    await page.getByRole("button", { name: "Switch" }).click();
    await page.getByRole("button", { name: "Use other identity" }).click();
    await expectProviderChoice(page);
    expect(google).toHaveLength(0);

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Use other identity" })).toBeVisible();
  });

  test("the dashboard's Add identity offers the same choice", async ({ context, page }) => {
    await installFakeApple(context);
    await installGoogleIdentity(page);

    await page.goto(`${APPLE_ORIGIN}/`);
    await page.getByRole("button", { name: "Switch" }).click();
    await page.getByRole("button", { name: "Add identity" }).click();
    await expectProviderChoice(page);
  });
});

test.describe("with Apple login off", () => {
  test("the start page shows Google alone, as before", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    await expect(page.getByText(CHOICE)).toHaveCount(0);
    await expect(page.getByRole("group", { name: CHOICE })).toHaveCount(0);
  });

  test("Use other identity goes straight to Google, as before", async ({ context, page }) => {
    const google = await fakeGoogle(context);
    await installGoogleIdentity(page);

    await page.goto(authorizeUrl(""));
    await page.getByRole("button", { name: "Switch" }).click();
    await page.getByRole("button", { name: "Use other identity" }).click();

    await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//u);
    expect(google).toHaveLength(1);
  });

  test("an authorization without an identity goes straight to Google", async ({
    context,
    page,
  }) => {
    const google = await fakeGoogle(context);

    await page.goto(authorizeUrl(""));

    await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//u);
    expect(google).toHaveLength(1);
  });
});

for (const [name, origin] of [
  ["on", APPLE_ORIGIN],
  ["off", ""],
] as const) {
  test(`with Apple ${name}, any fragment parameter besides d is rejected`, async ({
    context,
    page,
  }) => {
    const google = await fakeGoogle(context);

    await page.goto(authorizeUrl(origin, "&x-provider=apple"));

    await expect(
      page.getByRole("heading", { name: "Invalid authorization request" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    expect(google).toHaveLength(0);
  });
}

for (const [name, origin, account, storage] of [
  ["on", APPLE_ORIGIN, "Apple or Google account", "iCloud or Google Drive"],
  ["off", "", "Google account", "Google Drive"],
] as const) {
  test(`with Apple ${name}, How? explains Passport for the providers that are on`, async ({
    context,
    page,
  }, testInfo) => {
    await installFakeApple(context);
    const isPhone = testInfo.project.name === "mobile-chromium";
    await page.goto(`${origin}/`);

    // No help mark inside the provider buttons and no README link anywhere.
    await expect(page.getByRole("button", { name: /About signing in/u })).toHaveCount(0);
    await expect(page.locator('a[href*="README"]')).toHaveCount(0);

    const how = page.getByRole("button", { name: "How?" });
    const explainer = page.getByRole("dialog", { name: "How Passport works" });
    if (isPhone) {
      await how.click();
    } else {
      // Keyboard: Enter opens it, Escape closes it and focus returns to How?.
      await how.focus();
      await expect(explainer).toBeHidden();
      await page.keyboard.press("Enter");
    }
    await expect(explainer).toBeVisible();
    await expect(explainer).toContainText(`Your ${account} identifies you`);
    await expect(explainer).toContainText(`stored in ${storage}`);
    await expect(explainer.getByRole("link")).toHaveCount(0);
    await expect(explainer.getByRole("button")).toHaveCount(1);
    if (name === "off") await expect(explainer).not.toContainText(/Apple|iCloud/u);
    const box = await explainer.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
    if (isPhone) expect(Math.abs(box!.y + box!.height - viewport!.height)).toBeLessThanOrEqual(1);

    if (isPhone) {
      await explainer.getByRole("button", { name: "Close" }).click();
    } else {
      await page.keyboard.press("Escape");
    }
    await expect(explainer).toBeHidden();
    if (!isPhone) await expect(how).toBeFocused();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });
}
