import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "./helpers/passportTest";

const APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SUBJECT = "google-permission-test";
const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECRET_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const APP_REQUEST =
  "pubkyauth://signin?caps=/pub/app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Example%20App";
const PERMISSION_CAPTION =
  "In Google’s window, tick Select all (or both Drive boxes), then press Continue.";
const WAITING_CAPTION = "What to tick in Google’s window";
const PERMISSION_HINT = "Google will ask for two Drive permissions. Tick both.";
/** An app's sign-in popup. */
const POPUP = { width: 520, height: 760 };

async function mockGoogleGrant(context: BrowserContext, scope: string) {
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
    const request = new URL(route.request().url());
    const redirectUri = request.searchParams.get("redirect_uri");
    const state = request.searchParams.get("state");
    if (!redirectUri || !state)
      throw new Error("Google authorization is missing its callback or state");
    const claims = Buffer.from(
      JSON.stringify({
        sub: SUBJECT,
        nonce: request.searchParams.get("nonce"),
      }),
    ).toString("base64url");
    const response = new URL(redirectUri);
    response.hash = new URLSearchParams({
      access_token: "test-drive-token",
      id_token: `header.${claims}.signature`,
      state,
      scope,
      expires_in: "3600",
    }).toString();
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>location.replace(${JSON.stringify(response.href)})</script>`,
    });
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
    route.fulfill({
      json: { sub: SUBJECT, email: "test@example.com", name: "Test" },
    }),
  );
}

test("detachment requires both permissions using the shared screen", async ({
  context,
  page,
}, testInfo) => {
  await mockGoogleGrant(context, APP_DATA_SCOPE);
  const driveRequests: string[] = [];
  await context.route("https://www.googleapis.com/**", (route) => {
    driveRequests.push(route.request().url());
    return route.fulfill({ status: 403, json: { error: "unexpected Drive request" } });
  });
  await installBoundIdentity(page);
  await page.goto("/");
  await confirmDetachment(page);

  await expect(page.getByRole("heading", { name: "Drive access required." })).toBeVisible();
  await expect(page.getByText(/both Google Drive permissions to delete/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue without visible backup" })).toHaveCount(
    0,
  );
  expect(driveRequests).toEqual([]);
  expect(
    await page.evaluate(
      ({ root, publicKey }) => localStorage.getItem(`${root}/identity/${publicKey}`),
      { root: STORAGE_ROOT, publicKey: PUBLIC_KEY },
    ),
  ).not.toBeNull();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("detachment-permissions.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Drive access required." })).toBeVisible();
  expect(driveRequests).toEqual([]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detach from Google." })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("detaching removes the Google backup and keeps the identity active in this browser", async ({
  context,
  page,
}) => {
  await mockGoogleGrant(context, `${APP_DATA_SCOPE} ${DRIVE_FILE_SCOPE}`);
  const driveRequests: string[] = [];
  await context.route("https://www.googleapis.com/**", (route) => {
    driveRequests.push(route.request().method());
    // No app-data file and no visible recovery folder are left, so nothing needs decrypting.
    return route.fulfill({ json: { files: [] } });
  });
  await installBoundIdentity(page);
  await page.goto("/");
  await confirmDetachment(page);

  await expect(page.getByRole("heading", { name: "Detached from Google." })).toBeVisible();
  expect(driveRequests.length).toBeGreaterThan(0);
  expect(driveRequests.every((method) => method === "GET")).toBe(true);
  const stored = await page.evaluate(
    ({ root, publicKey }) => ({
      identity: localStorage.getItem(`${root}/identity/${publicKey}`),
      active: localStorage.getItem(`${root}/active`),
    }),
    { root: STORAGE_ROOT, publicKey: PUBLIC_KEY },
  );
  expect(stored.active).toBe(PUBLIC_KEY);
  const identity = JSON.parse(stored.identity ?? "null") as Record<string, unknown> | null;
  expect(identity).toMatchObject({ publicKeyZ32: PUBLIC_KEY, secretKey: SECRET_KEY });
  expect(identity).not.toHaveProperty("googleAccount");

  // Done returns to Manage identity, where detaching started.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Google account" }).getByRole("button", {
      name: "Attach to Google",
    }),
  ).toBeVisible();
});

test("the waiting screen puts its actions first and cancels back to the entry", async ({
  context,
  page,
}) => {
  await stallGoogleAuthorization(context);
  await page.setViewportSize(POPUP);
  await page.goto("/");
  const signIn = page.getByRole("button", { name: "Continue with Google", exact: true });
  await expect(signIn).toHaveAccessibleDescription(PERMISSION_HINT);
  const popupPromise = page.waitForEvent("popup");
  await signIn.click();
  const popup = await popupPromise;

  await expect(page.getByRole("heading", { name: /^Requesting Google/ })).toBeVisible();
  const waiting = page.getByRole("status");
  await expect(waiting).toHaveText("Waiting for Google…");
  // The lead gives the instruction, so the guide's caption only names the picture.
  await expect(page.getByRole("figure")).toContainText(WAITING_CAPTION);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Focus follows the screen: the first Tab from the screen reaches Cancel, not the guide.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();

  const show = page.getByRole("button", { name: "Show Google’s window" });
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    // Phones open Google’s window as a tab, which a page may not be able to bring back.
    await expect(show).toBeHidden();
    await expect(page.getByText("Switch back to the Google tab to finish.")).toBeVisible();
  } else {
    await expect(page.getByText("Switch back to the Google tab to finish.")).toBeHidden();
    await expectAboveFold(page, ["Cancel", "Show Google’s window"]);
    // Whether the window came to the front cannot be observed here (headless browsers report
    // every page as focused); the controller's tests cover the focus request. Show must not
    // end the attempt.
    await show.click();
    await expect(waiting).toHaveText("Waiting for Google…");
    expect(popup.isClosed()).toBe(false);
  }

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
  // A cancel is not a failure: nothing reports the closed window afterwards.
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByText("google_authorization_popup_closed")).toHaveCount(0);
});

test("detaching waits for Google's window with Cancel and removes nothing", async ({
  context,
  page,
}) => {
  await stallGoogleAuthorization(context);
  const driveRequests: string[] = [];
  await context.route("https://www.googleapis.com/**", (route) => {
    driveRequests.push(route.request().url());
    return route.fulfill({ status: 403, json: { error: "unexpected Drive request" } });
  });
  await installBoundIdentity(page);
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await confirmDetachment(page);
  const popup = await popupPromise;

  await expect(page.getByRole("heading", { name: /^Requesting Google/ })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Waiting for Google…");
  // The confirmation no longer claims a removal is under way while Google's window is open.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Removing…" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Detach from Google." })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => popup.isClosed()).toBe(true);
  await page.waitForTimeout(500);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(driveRequests).toEqual([]);
  const identity = await page.evaluate(
    ({ root, publicKey }) => localStorage.getItem(`${root}/identity/${publicKey}`),
    { root: STORAGE_ROOT, publicKey: PUBLIC_KEY },
  );
  expect(JSON.parse(identity ?? "null")).toHaveProperty("googleAccount.googleSubject", SUBJECT);
});

test("the Drive permission guide stays still until played and never pushes the actions below the fold", async ({
  context,
  page,
}, testInfo) => {
  await mockGoogleGrant(context, APP_DATA_SCOPE);
  await context.route("https://www.googleapis.com/drive/v3/files**", (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  await page.setViewportSize(POPUP);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST)}`);
  // A request opens on its identity list; Google is one step further, beside backup import.
  await page.getByRole("button", { name: "Continue with Google or import a backup" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Drive access optional." });
  await expect(heading).toBeVisible();

  const guide = page.getByRole("figure");
  await expect(guide).toContainText(PERMISSION_CAPTION);
  await expect(guide.getByRole("img")).toHaveAttribute(
    "src",
    "/illustrations/google-drive-permissions-still.png",
  );
  const actions = ["Back", "Try again", "Continue without visible backup"];
  for (const viewport of [POPUP, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    // Focus follows the screen: the first Tab after the heading reaches Back, not the guide.
    await heading.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeFocused();
    await expectAboveFold(page, actions);
    // The animation is taller than the still; it follows the actions, so it moves none of them.
    await guide.getByRole("button", { name: "Play animation" }).click();
    await expect(guide.getByRole("img", { name: /^Animation/ })).toHaveAttribute(
      "src",
      "/illustrations/google-drive-permissions.gif",
    );
    await expectAboveFold(page, actions);
    await guide.getByRole("button", { name: "Pause animation" }).click();
    await expect(guide.getByRole("img")).toHaveAttribute(
      "src",
      "/illustrations/google-drive-permissions-still.png",
    );
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize(POPUP);
  await page.screenshot({
    path: testInfo.outputPath("optional-backup-permissions-popup.png"),
    fullPage: true,
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(guide.getByRole("button", { name: "Play animation" })).toBeHidden();
});

test("new identities reach optional backup consent only after a Drive lookup", async ({
  context,
  page,
}, testInfo) => {
  await mockGoogleGrant(context, APP_DATA_SCOPE);
  const driveRequests: string[] = [];
  await context.route("https://www.googleapis.com/drive/v3/files**", (route) => {
    driveRequests.push(route.request().method());
    return route.fulfill({ json: { files: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  expect(driveRequests).toEqual(["GET"]);
  await expect(page.getByRole("button", { name: "Continue without visible backup" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("optional-backup-permissions.png"),
    fullPage: true,
  });
});

for (const [probe, answer] of [
  ["missing", (route: Route) => route.fulfill({ status: 404, body: "" })],
  ["blocked", (route: Route) => route.fulfill({ status: 403, body: "" })],
  ["unreachable", (route: Route) => route.abort("failed")],
] as const) {
  test(`Google sign-in reaches the Drive lookup before Homegate while the probe is ${probe}`, async ({
    context,
    page,
  }) => {
    const homegateMethods: string[] = [];
    await context.route("**/google_verification", (route) => {
      homegateMethods.push(route.request().method());
      return answer(route);
    });
    await mockGoogleGrant(context, APP_DATA_SCOPE);
    const driveRequests: string[] = [];
    await context.route("https://www.googleapis.com/drive/v3/files**", (route) => {
      driveRequests.push(route.request().method());
      return route.fulfill({ json: { files: [] } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    // The lookup decides between restoring and creating; only creating needs Homegate.
    await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
    expect(driveRequests).toEqual(["GET"]);
    expect(homegateMethods).not.toContain("POST");
  });
}

test("Google attachment stays within narrow screens while authorizing and retrying", async ({
  context,
  page,
}, testInfo) => {
  await installDetachedIdentity(page);
  await stallGoogleAuthorization(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Manage identity" }).click();
  const googleAccount = page.getByRole("region", { name: "Google account" });
  await expect(googleAccount.getByRole("button", { name: "Attach to Google" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Backup & key access" })
      .getByRole("region", { name: "Google account" })
      .getByRole("button", { name: "Attach to Google" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("google-account-section.png"),
    fullPage: true,
  });
  await googleAccount.getByRole("button", { name: "Attach to Google" }).click();
  await expect(page.getByRole("heading", { name: "Attach to Google." })).toBeVisible();
  await expect(page.getByText(PERMISSION_HINT)).toBeVisible();
  let popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Attach to Google" }).click();
  let popup = await popupPromise;
  await expect(page.getByRole("status")).toHaveText("Waiting for Google…");
  await expectAttachmentFits(page);
  await page.screenshot({
    path: testInfo.outputPath("google-attachment-pending.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Attach to Google." })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Attach to Google" }).click();
  popup = await popupPromise;
  await expect(page.getByRole("status")).toHaveText("Waiting for Google…");
  await popup.close();
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeEnabled();
  await expect(retry.locator("svg")).toBeVisible();
  await expectAttachmentFits(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("google-attachment-retry.png"),
    fullPage: true,
  });
});

for (const [grant, scope] of [
  ["both permissions", `${APP_DATA_SCOPE} ${DRIVE_FILE_SCOPE}`],
  ["only private storage", APP_DATA_SCOPE],
] as const) {
  test(`attaching an occupied Google account with ${grant} only lists metadata and preserves the local identity`, async ({
    context,
    page,
  }) => {
    await installDetachedIdentity(page);
    await mockGoogleGrant(context, scope);
    const requests: Array<{ method: string; path: string; alt: string | null }> = [];
    await context.route("https://www.googleapis.com/**", (route) => {
      const url = new URL(route.request().url());
      requests.push({
        method: route.request().method(),
        path: url.pathname,
        alt: url.searchParams.get("alt"),
      });
      return route.fulfill({
        json: { files: [{ id: "existing-backup", name: "passport.json", version: "1" }] },
      });
    });
    let wrappingRequests = 0;
    await context.route("**/api/wrapping-key/google", (route) => {
      wrappingRequests++;
      return route.fulfill({ status: 500 });
    });
    await page.goto("/");
    const before = await page.evaluate(() => JSON.stringify(localStorage));
    await page.getByRole("button", { name: "Manage identity" }).click();
    await page.getByRole("button", { name: "Attach to Google" }).click();
    await page.getByRole("button", { name: "Attach to Google" }).click();
    // The occupied account is reported before any visible-copy consent is asked for.
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "already has a Passport backup",
    );
    await expect(page.getByRole("button", { name: "Continue without visible backup" })).toHaveCount(
      0,
    );
    expect(requests).toEqual([{ method: "GET", path: "/drive/v3/files", alt: null }]);
    expect(wrappingRequests).toBe(0);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
    await expect(page.getByRole("button", { name: "Try again" }).locator("svg")).toBeVisible();
  });
}

/** Google's window stays on its account chooser, as when the person has not answered yet. */
async function stallGoogleAuthorization(context: BrowserContext) {
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Choose an account</title>Choose an account",
    }),
  );
}

/** Every named button ends inside the viewport without scrolling. */
async function expectAboveFold(page: Page, names: readonly string[]) {
  const fold = page.viewportSize()!.height;
  for (const name of names) {
    const bottom = await page
      .getByRole("button", { name, exact: true })
      .evaluate((button) => button.getBoundingClientRect().bottom + window.scrollY);
    expect(bottom, `${name} at ${page.viewportSize()!.width}px`).toBeLessThanOrEqual(fold);
  }
}

async function installBoundIdentity(page: Page) {
  await page.addInitScript(
    ({ publicKey, secretKey, subject, root }) => {
      localStorage.setItem(
        `${root}/identity/${publicKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: publicKey,
          secretKey,
          googleAccount: {
            googleSubject: subject,
            email: "test@example.com",
            name: "Test",
            pictureUrl: null,
          },
        }),
      );
      localStorage.setItem(`${root}/active`, publicKey);
    },
    { publicKey: PUBLIC_KEY, secretKey: SECRET_KEY, subject: SUBJECT, root: STORAGE_ROOT },
  );
}

async function confirmDetachment(page: Page) {
  await page.getByRole("button", { name: "Manage identity", exact: true }).click();
  await page.getByRole("button", { name: "Detach from Google" }).click();
  await page.getByRole("button", { name: "I backed up my pubky" }).click();
  await page.getByRole("button", { name: "Remove Google Access" }).click();
  await page.getByLabel("Type DETACH to confirm").fill("DETACH");
  await page.getByRole("button", { name: "Confirm detachment" }).click();
}

async function installDetachedIdentity(page: Page) {
  await page.addInitScript(
    ({ publicKey, secretKey, root }) => {
      localStorage.setItem(
        `${root}/identity/${publicKey}`,
        JSON.stringify({ v: 1, publicKeyZ32: publicKey, secretKey }),
      );
      localStorage.setItem(`${root}/active`, publicKey);
    },
    { publicKey: PUBLIC_KEY, secretKey: SECRET_KEY, root: STORAGE_ROOT },
  );
}

async function expectAttachmentFits(page: Page) {
  for (const width of [1280, 560, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const button of await page.locator("main button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  }
}
