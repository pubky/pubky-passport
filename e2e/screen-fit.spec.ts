import { E2E_PORT } from "./helpers/e2eServer";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { PKARR_RELAY_HOSTS } from "./helpers/network";
import { expect, test, type BrowserContext, type Page } from "./helpers/passportTest";
import {
  HOMESERVER,
  homeserverRecord,
  mockPublicProfile,
  PROFILE_KEY,
  seedProfileIdentity,
} from "./helpers/pubkyProfile";

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

/**
 * A Passport file names an HTTPS origin, so creating a Google identity runs here, an origin every
 * request of which is answered by the e2e server.
 */
const SECURE_ORIGIN = "https://passport.test";

/**
 * Plays the network for creating an identity with Google on {@link SECURE_ORIGIN}: Google grants
 * only the first Drive permission, Drive starts empty, Passport's server and Homegate answer, and
 * the test homeserver accepts the signup and signs the new key in.
 */
async function mockGoogleCreation(context: BrowserContext): Promise<void> {
  await context.route(`${SECURE_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/wrapping-key/google") {
      return route.fulfill({
        json: { wrappingKey: Buffer.alloc(32, 7).toString("base64url"), keyId: "e2e" },
      });
    }
    const response = await route.fetch({
      url: `http://127.0.0.1:${E2E_PORT}${url.pathname}${url.search}`,
      maxRedirects: 0,
    });
    return route.fulfill({ response });
  });
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", (route) => {
    const request = new URL(route.request().url());
    const claims = Buffer.from(
      JSON.stringify({
        sub: GOOGLE_ACCOUNT.googleSubject,
        nonce: request.searchParams.get("nonce"),
      }),
    ).toString("base64url");
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    callback.hash = new URLSearchParams({
      access_token: "e2e-drive-token",
      id_token: `header.${claims}.signature`,
      state: request.searchParams.get("state")!,
      scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
      expires_in: "3600",
    }).toString();
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>location.replace(${JSON.stringify(callback.href)})</script>`,
    });
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
    route.fulfill({
      json: {
        sub: GOOGLE_ACCOUNT.googleSubject,
        email: GOOGLE_ACCOUNT.email,
        name: GOOGLE_ACCOUNT.name,
      },
    }),
  );
  // Drive holds nothing until Passport uploads its file, which later lists then return.
  const driveFiles: { id: string; name: string; version: string }[] = [];
  await context.route("https://www.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/upload/drive/v3/files") {
      const file = { id: "passport-file", name: "passport.json", version: "1" };
      driveFiles.push(file);
      return route.fulfill({ json: file });
    }
    return route.fulfill({ json: { files: driveFiles } });
  });
  await context.route("**/google_verification", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { signupCode: "G00G-1E51-GNVP", homeserverPubky: HOMESERVER } })
      : route.fallback(),
  );
  // Records published for the new key are served back to later lookups.
  const published = new Map<string, Buffer>();
  await context.route(
    (url) => PKARR_RELAY_HOSTS.has(url.hostname),
    (route) => {
      const key = new URL(route.request().url()).pathname.slice(1);
      if (route.request().method() !== "GET") {
        const record = route.request().postDataBuffer();
        if (record) published.set(key, record);
        return route.fulfill({ status: 200, body: "" });
      }
      const body = published.get(key) ?? homeserverRecord(key);
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    },
  );
  await context.route("https://homeserver.example/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/signup_tokens/")) return route.fallback();
    if (url.pathname === "/auth/grant/session" && request.method() === "POST") {
      const { grant } = request.postDataJSON() as { grant: string };
      const claims = JSON.parse(
        Buffer.from(grant.split(".")[1]!, "base64url").toString("utf8"),
      ) as { iss: string; client_id: string; caps: string[]; jti: string; exp: number };
      const now = Math.floor(Date.now() / 1000);
      return route.fulfill({
        json: {
          token: "e2e-bearer",
          session: {
            homeserver: HOMESERVER,
            pubky: claims.iss,
            client_id: claims.client_id,
            capabilities: claims.caps,
            grant_id: claims.jti,
            token_expires_at: now + 3_600,
            grant_expires_at: claims.exp,
            created_at: now,
          },
        },
      });
    }
    return route.fulfill({ status: request.method() === "GET" ? 404 : 200, body: "" });
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

test("pill labels fit their pills in the popup zoomed to 200%", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 380 });
  await page.goto("/");
  // A short label stays on one line.
  const create = await page
    .getByRole("button", { name: "Create account", exact: true })
    .boundingBox();
  expect(create!.height).toBe(60);
  // A longer label may wrap, but its pill holds all of it without clipping or pushing the page
  // sideways.
  const importFile = page.getByRole("button", { name: "Import recovery file", exact: true });
  expect(
    await importFile.evaluate(
      (button) =>
        button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight,
    ),
  ).toBe(true);
  expect(await horizontalOverflow(page)).toBe(0);
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
    // Back and Save profile stack instead of running off the edge, and the avatar stays round.
    const back = await page.getByRole("button", { name: "Back", exact: true }).boundingBox();
    const finish = await page.getByRole("button", { name: "Save profile" }).boundingBox();
    expect(back!.x + back!.width).toBeLessThanOrEqual(viewport.width);
    expect(finish!.x + finish!.width).toBeLessThanOrEqual(viewport.width);
    // The placeholder is decoration (no name), so it is found as the avatar section's image.
    const avatar = await page
      .getByRole("region", { name: "Avatar" })
      .locator("img")
      .first()
      .boundingBox();
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
  await page.getByRole("checkbox", { name: /^I have this pubky in Pubky Ring/u }).check();
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
  await mockGoogleCreation(context);
  await page.goto(`${SECURE_ORIGIN}${authorizeUrl(REQUEST)}`);
  await page
    .getByRole("button", { name: "Continue with Google or import a recovery file" })
    .click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  // Only the first Drive permission: the backup is made without its folder copy.
  await page.getByRole("button", { name: "Skip the folder copy" }).click();

  await expect(page.getByRole("heading", { name: "Backup ready." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/^No copy in your “Pubky Passport” Drive folder\./u)).toBeVisible();
  const scrollY = await page.evaluate(() => window.scrollY);
  const box = (await page.getByRole("button", { name: "Continue", exact: true }).boundingBox())!;
  expect(scrollY).toBe(0);
  expect(box.y + box.height).toBeLessThanOrEqual(760);
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
