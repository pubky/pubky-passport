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
  await expectTermsNotice(page, apple);
  return { apple, google };
}

const TERMS_CONSENT =
  "By continuing, you agree to the Pubky Passport Terms of Service and Privacy Policy, and confirm you are over 18.";
const TERMS_BUILT_BY =
  "Pubky Passport is powered by the Pubky protocol. Built by Synonym Software, S.A. DE C.V.";

/** The Terms/Privacy notice sits right under `lastButton` (or the import link under it), as wide as it, above any Back. */
async function expectTermsNotice(page: Page, lastButton: Locator): Promise<Locator> {
  const consent = page.locator("p", { hasText: "By continuing, you agree" });
  await expect(consent).toHaveCount(1);
  await expect(consent).toHaveText(TERMS_CONSENT);
  const notice = consent.locator("xpath=..");
  await expect(notice.locator("p")).toHaveText([TERMS_CONSENT, TERMS_BUILT_BY]);
  const links = notice.getByRole("link");
  await expect(links).toHaveText(["Terms of Service", "Privacy Policy"]);
  for (const [name, href] of [
    ["Terms of Service", "/terms-of-service"],
    ["Privacy Policy", "/privacy-policy"],
  ] as const) {
    const link = notice.getByRole("link", { name });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveCSS("text-decoration-line", "underline");
  }
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  const [buttonBox, noticeBox] = await Promise.all([
    lastButton.boundingBox(),
    notice.boundingBox(),
  ]);
  expect(buttonBox).not.toBeNull();
  expect(noticeBox).not.toBeNull();
  // The help control sits outside the pill, so compare with the pill row's own box.
  const row = await lastButton
    .locator("xpath=..")
    .evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect);
  expect(Math.abs((noticeBox?.x ?? 0) - row.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((noticeBox?.width ?? 0) - row.width)).toBeLessThanOrEqual(1);
  // The one-line import link, when shown, sits between the buttons and the notice.
  const importLine = page.locator("[data-passport-import-identity]");
  const importBox = (await importLine.count()) > 0 ? await importLine.boundingBox() : null;
  if (importBox) {
    expect(importBox.y).toBeGreaterThanOrEqual((buttonBox?.y ?? 0) + (buttonBox?.height ?? 0));
    expect(importBox.height).toBeLessThanOrEqual(24);
  }
  const above = importBox ?? buttonBox;
  const gap = (noticeBox?.y ?? 0) - ((above?.y ?? 0) + (above?.height ?? 0));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(24);
  const back = page.getByRole("button", { name: "Back" });
  if ((await back.count()) > 0) {
    const backBox = await back.boundingBox();
    expect(backBox?.y ?? 0).toBeGreaterThanOrEqual((noticeBox?.y ?? 0) + (noticeBox?.height ?? 0));
  }
  await expectSignInFooter(page, notice);
  return notice;
}

/** The footer's own "powered by" paragraph (mobile only; md:hidden on desktop). */
function footerBuiltBy(page: Page): Locator {
  return page
    .getByRole("contentinfo")
    .locator("p", { hasText: "Pubky Passport is powered by the" });
}

/**
 * Next to the notice the page ends with the Synonym badge right under it, and the footer is gone:
 * the notice already links Terms and Privacy and says who built Passport.
 */
async function expectSignInFooter(page: Page, notice: Locator): Promise<void> {
  await expect(page.getByRole("contentinfo")).toBeHidden();
  await expect(footerBuiltBy(page)).toBeHidden();
  await expect(page.locator("p:visible", { hasText: "powered by the Pubky protocol" })).toHaveCount(
    1,
  );
  for (const name of ["Terms of Service", "Privacy Policy"]) {
    await expect(page.getByRole("link", { name })).toHaveCount(1);
  }
  const badge = page.getByRole("img", { name: "Synonym, a Tether company" });
  await expect(badge).toHaveCount(1);
  await expect(badge).toBeVisible();
  const [noticeBox, badgeBox] = await Promise.all([notice.boundingBox(), badge.boundingBox()]);
  const gap = (badgeBox?.y ?? 0) - ((noticeBox?.y ?? 0) + (noticeBox?.height ?? 0));
  expect(gap).toBeGreaterThanOrEqual(8);
  expect(gap).toBeLessThanOrEqual(24);
  expect(Math.abs((badgeBox?.x ?? 0) - (noticeBox?.x ?? 0))).toBeLessThanOrEqual(1);
}

/** Pages without the sign-in notice show the footer, with its line on mobile, as before. */
async function expectFooterBuiltByShown(page: Page): Promise<void> {
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(footerBuiltBy(page)).toBeVisible();
  await expect(footerBuiltBy(page)).toHaveText(
    "Pubky Passport is powered by the Pubky protocol. Built by Synonym Software, S.A. DE C.V. ©2026.",
  );
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

  test("Continue with Google matches the compact Figma pill and keeps its G artwork", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    await page.goto(`${APPLE_ORIGIN}/`);
    const { google } = await expectProviderChoice(page);
    const style = await google.evaluate((button) => {
      const computed = getComputedStyle(button);
      return {
        background: computed.backgroundColor,
        color: computed.color,
        family: computed.fontFamily,
        size: computed.fontSize,
        weight: computed.fontWeight,
      };
    });
    expect(style.background).toBe("rgb(255, 255, 255)");
    expect(style.color).toBe("rgb(29, 29, 32)");
    expect(style.family).toContain("Inter Tight");
    expect(style.size).toBe("14px");
    expect(style.weight).toBe("700");
    await expect(google.locator("img[src='/brand/google-sign-in-g.png']")).toHaveCount(1);
    const logoBox = await google.locator("img").boundingBox();
    expect(logoBox?.height).toBe(16);
    expect(logoBox?.width).toBe(16);
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

  test("the Terms and Privacy links open in a new tab and keep the authorization", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    const google = await fakeGoogle(context);
    await page.goto(authorizeUrl(APPLE_ORIGIN));
    const { apple } = await expectProviderChoice(page);
    const notice = await expectTermsNotice(page, apple);

    for (const [name, path, heading] of [
      ["Terms of Service", "/terms-of-service", /Terms of Service/u],
      ["Privacy Policy", "/privacy-policy", /Privacy Policy/u],
    ] as const) {
      const opened = context.waitForEvent("page");
      await notice.getByRole("link", { name }).click();
      const legal = await opened;
      await legal.waitForLoadState();
      expect(new URL(legal.url()).pathname).toBe(path);
      await expect(legal.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await legal.close();
    }
    expect(page.url()).toBe(`${APPLE_ORIGIN}/authorize`);
    await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
    await expectProviderChoice(page);
    expect(google).toHaveLength(0);
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

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${APPLE_ORIGIN}/`);
      await page.getByRole("button", { name: "Switch" }).click();
      await page.getByRole("button", { name: "Add identity" }).click();
      await expectProviderChoice(page);
    }
  });

  test("the sign-in screens end with the Synonym badge and no footer on /authorize and Use other identity at every width", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    await fakeGoogle(context);

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(authorizeUrl(APPLE_ORIGIN));
      await expectProviderChoice(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    }

    await installGoogleIdentity(page);
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${APPLE_ORIGIN}/terms-of-service`);
      await page.goto(authorizeUrl(APPLE_ORIGIN));
      await page.getByRole("button", { name: "Switch" }).click();
      await page.getByRole("button", { name: "Use other identity" }).click();
      await expectProviderChoice(page);
    }
  });

  test("pages without the sign-in notice keep the footer and its powered-by line", async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    await fakeGoogle(context);
    await installGoogleIdentity(page);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${APPLE_ORIGIN}/`);
      await expect(page.getByText("Google User")).toBeVisible();
      await expectFooterBuiltByShown(page);

      await page.goto(`${APPLE_ORIGIN}/terms-of-service`);
      await expect(
        page.getByRole("heading", { level: 1, name: /Terms of Service/u }),
      ).toBeVisible();
      await expectFooterBuiltByShown(page);

      await page.goto(`${APPLE_ORIGIN}/privacy-policy`);
      await expect(page.getByRole("heading", { level: 1, name: /Privacy Policy/u })).toBeVisible();
      await expectFooterBuiltByShown(page);

      // The authorization review keeps it; leaving the sign-in brings it back without a reload.
      await page.goto(authorizeUrl(APPLE_ORIGIN));
      await expect(page.getByRole("heading", { name: "Sign in to Client" })).toBeVisible();
      await expectFooterBuiltByShown(page);
      await page.getByRole("button", { name: "Switch" }).click();
      await page.getByRole("button", { name: "Use other identity" }).click();
      await expectProviderChoice(page);
      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByRole("button", { name: "Use other identity" })).toBeVisible();
      await expectFooterBuiltByShown(page);
    }
  });
});

test.describe("with Apple login off", () => {
  test("the start page shows Google alone, as before", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    await expect(page.getByText(CHOICE)).toHaveCount(0);
    await expect(page.getByRole("group", { name: CHOICE })).toHaveCount(0);
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await expectTermsNotice(page, page.getByRole("button", { name: "Continue with Google" }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    }
  });

  test("the dashboard's Add identity shows Google with the same notice", async ({ page }) => {
    await installGoogleIdentity(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Switch" }).click();
    await page.getByRole("button", { name: "Add identity" }).click();
    await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    await expectTermsNotice(page, page.getByRole("button", { name: "Continue with Google" }));
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

for (const [name, origin] of [
  ["on", APPLE_ORIGIN],
  ["off", ""],
] as const) {
  test(`with Apple ${name}, How? stays neutral and Continue returns to provider choices`, async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    const google = await fakeGoogle(context);
    await page.goto(`${origin}/`);
    await expect(page.getByRole("button", { name: /About signing in/u })).toHaveCount(0);
    await expect(page.locator('a[href*="README"]')).toHaveCount(0);
    const how = page.getByRole("button", { name: "How?" });
    const explainer = page.getByRole("dialog", {
      name: "Continue with your account, powered by Pubky Passport.",
    });
    await how.focus();
    await page.keyboard.press("Enter");
    await expect(explainer).toBeVisible();
    await expect(explainer.getByRole("heading")).toBeFocused();
    await expect(explainer).not.toContainText(/Apple|Google|iCloud|Drive/u);
    await expect(explainer.locator("p > strong")).toHaveCount(4);
    const expectedBody = [
      "Your provider: Your account provider helps you sign in and find your encrypted backup. It does not create or control your pubky.",
      "Your keys: Your keys are created in your browser and encrypted before they are saved in your cloud storage.",
      "Recovery: When you sign in, Passport retrieves your encrypted backup and the separate key needed to unlock it.",
      "Split security: Your encrypted backup and the key that unlocks it are stored separately.",
    ];
    await expect(explainer.locator("p")).toHaveText(expectedBody);
    const sharedBody = await explainer.locator("p").allTextContents();
    await expect(explainer.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await expect(explainer.getByRole("button", { name: "Learn more" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(explainer).toBeHidden();
    await expect(how).toBeFocused();
    await how.click();
    await explainer.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(explainer).toBeHidden();
    await expect(page.getByRole("group", { name: "Available sign-in accounts" })).toBeFocused();
    for (const provider of name === "on" ? ["Google", "Apple"] : ["Google"]) {
      await page.getByRole("button", { name: `How ${provider} sign-in works` }).click();
      const providerHelp = page.getByRole("dialog", {
        name: `Continue with ${provider}, powered by Pubky Passport.`,
      });
      await expect(providerHelp.locator("p")).toHaveText(expectedBody);
      expect(await providerHelp.locator("p").allTextContents()).toEqual(sharedBody);
      await expect(
        providerHelp.getByRole("button", { name: `Continue with ${provider}` }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
    }
    expect(google).toHaveLength(0);
    expect(context.pages()).toHaveLength(1);
  });
}
