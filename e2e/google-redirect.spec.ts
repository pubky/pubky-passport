import {
  expectNoncePreimageOnlyForPassport,
  mockGoogleCreation,
  SECURE_ORIGIN,
} from "./helpers/googleCreation";
import { expect, test, type BrowserContext, type Page } from "./helpers/passportTest";
import { UNVERIFIED_BAND, UNVERIFIED_HEADING } from "./helpers/requester";

const STORAGE_KEY = "pubky-passport/google-redirect/v1";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const REQUEST = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client&x-cancel=https%3A%2F%2Fclient.example%2Fcancel`;
const ENTRY = `/authorize#d=${encodeURIComponent(REQUEST)}`;
const GOOGLE_ACCOUNT = {
  googleSubject: "google-redirect-user",
  email: "test@example.com",
  name: "Test",
};

const BLOCKED_NOTE = "Your browser blocked Google’s window, so Passport continues in this tab.";

/**
 * Google's side: it answers in the window that asked (its own pop-up, or Passport's when the
 * browser blocked that), on the origin root. `hold` keeps it from answering until released.
 */
async function google(
  context: BrowserContext,
  options: { denied?: boolean; wrongState?: boolean; hold?: Promise<void> } = {},
) {
  const requests: URL[] = [];
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
    const request = new URL(route.request().url());
    requests.push(request);
    await options.hold;
    const response = new URL(request.searchParams.get("redirect_uri")!);
    const claims = Buffer.from(
      JSON.stringify({
        sub: GOOGLE_ACCOUNT.googleSubject,
        nonce: request.searchParams.get("nonce"),
      }),
    ).toString("base64url");
    response.hash = new URLSearchParams({
      state: options.wrongState ? "wrong" : request.searchParams.get("state")!,
      ...(options.denied
        ? { error: "access_denied" }
        : {
            access_token: "redirect-access-canary",
            id_token: `header.${claims}.signature`,
            scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
            expires_in: "3600",
          }),
    }).toString();
    await route
      .fulfill({
        contentType: "text/html",
        body: `<!doctype html><script>location.replace(${JSON.stringify(response.href)})</script>`,
      })
      // A window closed while Google was held back has nothing left to answer.
      .catch(() => undefined);
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
  await context.route("https://www.googleapis.com/drive/v3/files**", (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  await context.route("https://client.example/cancel", (route) =>
    route.fulfill({ contentType: "text/html", body: "Cancelled" }),
  );
  return requests;
}

/** The browser blocks every pop-up Passport's page asks for, as a strict pop-up blocker does. */
async function blockPopups(page: Page) {
  await page.addInitScript(() => {
    window.open = () => null;
  });
}

/** Every address the page's own window went to. */
function navigations(page: Page): string[] {
  const urls: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}

/** The request's start page: nothing is saved, so it is the request's first step. */
async function startPage(page: Page) {
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  return page.getByRole("region", { name: "Create account" });
}

async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify([localStorage, sessionStorage, history.state]));
}

test("Continue with Google opens Google's own window by default, and the request stays on its page", async ({
  context,
  page,
}) => {
  const requests = await google(context);
  await page.goto(ENTRY);
  const create = await startPage(page);
  const visited = navigations(page);
  const popupPromise = page.waitForEvent("popup");
  await create.getByRole("button", { name: "Continue with Google", exact: true }).click();
  const popup = await popupPromise;

  // Google answered in its own window, which closed; Passport's page never left the request.
  await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(new URL(page.url()).pathname).toBe("/authorize");
  expect(visited).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.href).not.toContain(SECRET);
  await expect(page.getByText(BLOCKED_NOTE)).toHaveCount(0);
  // Nothing of the request was saved for a return: there is none.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
  expect(await storageDump(page)).not.toContain("redirect-access-canary");
  // The request is still this page's: Back shows its start page, and Cancel answers the app.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await startPage(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL("https://client.example/cancel");
});

test("closing Google's window is not a block: Passport stays on the request and leaves for nowhere", async ({
  context,
  page,
}) => {
  let release = () => undefined as void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests = await google(context, { hold });
  await page.goto(ENTRY);
  const create = await startPage(page);
  const visited = navigations(page);
  const popupPromise = page.waitForEvent("popup");
  await create.getByRole("button", { name: "Continue with Google", exact: true }).click();
  const popup = await popupPromise;
  // Passport waits beside Google's window (a phone is told to switch tabs instead of a button).
  await expect(page.getByRole("status").filter({ hasText: "Waiting" })).toHaveText(
    "Waiting for Google…",
  );
  await expect.poll(() => requests.length).toBe(1);

  // The person closes Google's window without answering.
  await popup.close();
  await expect(
    page.getByText("You closed Google’s window before finishing. Nothing was created or changed."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(BLOCKED_NOTE)).toHaveCount(0);
  // No same-tab continuation: the page did not move, saved nothing, and asked Google no more.
  await page.waitForTimeout(1_000);
  expect(visited).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/authorize");
  expect(requests).toHaveLength(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
  release();
  // Back returns to the request's start page, where every way in is still offered.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    (await startPage(page)).getByRole("button", { name: "Continue with SMS" }),
  ).toBeVisible();
});

test("a blocked Google window says so and continues in this tab", async ({ context, page }) => {
  let release = () => undefined as void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests = await google(context, { hold });
  await blockPopups(page);
  await page.goto(ENTRY);
  await (
    await startPage(page)
  )
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();

  // On its way to Google, in this window: no second window, and the page says why.
  await expect(page.getByRole("main", { name: "Continuing with Google" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(BLOCKED_NOTE);
  await expect.poll(() => requests.length).toBe(1);
  expect(context.pages()).toHaveLength(1);
  release();
  await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

test("with Google's window blocked, the sign-in completes in the same window and the request is reviewed back on /authorize", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const { googleRequests: requests, ...google } = await mockGoogleCreation(context, GOOGLE_ACCOUNT);
  // A browser that refuses outright is a block as well.
  await page.addInitScript(() => {
    window.open = () => {
      throw new Error("No popups allowed");
    };
  });
  await page.goto(`${SECURE_ORIGIN}${ENTRY}`);
  // Passport does not leave for Google by itself: the start page offers it beside the other ways.
  const create = await startPage(page);
  await expect(create.getByRole("button", { name: "Continue with SMS" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await create.getByRole("button", { name: "Continue with Google", exact: true }).click();

  // Google answers on the origin root, where the sign-in goes on without another press. Only
  // the first Drive permission was granted, so the backup is made without its folder copy.
  await page.getByRole("button", { name: "Skip the folder copy" }).click();
  await expect(page.getByRole("heading", { name: "Backup ready." })).toBeVisible({
    timeout: 20_000,
  });
  expect(new URL(page.url()).pathname).toBe("/");
  expect(new URL(page.url()).hash).toBe("");
  expect(requests).toHaveLength(1);
  expect(context.pages()).toHaveLength(1);
  // Google never saw the request, and nothing of Google's stays in the browser's storage.
  expect(requests[0]!.href).not.toContain(SECRET);
  expect(requests[0]!.href).not.toContain("pubkyauth");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
  expect(await storageDump(page)).not.toContain("e2e-drive-token");
  expectNoncePreimageOnlyForPassport(google);
  // The callback page finishes the sign-in and nothing else: no review, no list.
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // A new account is asked for its profile once; skipping returns to the request's own page.
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  expect(new URL(page.url()).pathname).toBe("/authorize");
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  // The review is of the identity Google just set up.
  await expect(page.getByRole("region", { name: "Selected identity" })).toContainText(
    GOOGLE_ACCOUNT.email,
  );
  const storage = await storageDump(page);
  expect(storage).not.toContain("e2e-drive-token");
  expect(storage).not.toContain(SECRET);
  expect(context.pages()).toHaveLength(1);
  // The secure origin is proxied by a route; let its last fetches settle before the test ends.
  await page.waitForLoadState("networkidle");
  await context.unrouteAll({ behavior: "ignoreErrors" });
});

test("in the same tab, Google's answer is not asked for twice, and Back from its error returns to the request's start page", async ({
  context,
  page,
}) => {
  const requests = await google(context);
  await blockPopups(page);
  await page.goto(ENTRY);
  const create = await startPage(page);
  await create.getByRole("button", { name: "Continue with Google", exact: true }).click();

  // Drive holds no backup and only the first permission was granted: the sign-in stops to ask.
  await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  // The request still names nobody: its callback host is only where it returns (M3).
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toContainText(
    "Returns to client.example (unverified)",
  );
  expect(new URL(page.url()).pathname).toBe("/");
  expect(new URL(page.url()).hash).toBe("");
  expect(requests).toHaveLength(1);
  expect(context.pages()).toHaveLength(1);
  expect(requests[0]!.href).not.toContain(SECRET);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
  const storage = await storageDump(page);
  expect(storage).not.toContain("redirect-access-canary");
  expect(storage).not.toContain(SECRET);

  // Back does not show the request on this page: it returns to the page the request entered at.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await startPage(page);
  expect(new URL(page.url()).pathname).toBe("/authorize");
  expect(new URL(page.url()).hash).toBe("");
  // Cancel there answers the app, as it always did.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL("https://client.example/cancel");
});

test("in the same tab, a Google cancellation stays retryable without an automatic redirect loop", async ({
  context,
  page,
}) => {
  const requests = await google(context, { denied: true });
  await blockPopups(page);
  await page.goto(ENTRY);
  await (
    await startPage(page)
  )
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(context.pages()).toHaveLength(1);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(requests[0]!.searchParams.get("state")).not.toBe(requests[1]!.searchParams.get("state"));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await startPage(page);
  expect(new URL(page.url()).pathname).toBe("/authorize");
});

test("in the same tab, rejects a mismatched OAuth state without calling Google UserInfo", async ({
  context,
  page,
}) => {
  await google(context, { wrongState: true });
  await blockPopups(page);
  const profileRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/userinfo")) profileRequests.push(request.url());
  });
  await page.goto(ENTRY);
  await (
    await startPage(page)
  )
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(profileRequests).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test("with Google's window and the tab's storage both blocked, asks for the window without leaving Passport", async ({
  context,
  page,
}) => {
  const requests = await google(context);
  await blockPopups(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto(ENTRY);
  // The request still opens: only the Google round trip in this tab needs its storage.
  await (
    await startPage(page)
  )
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  // Neither way to Google is open; allowing the window is what the person can do about it.
  await expect(
    page.getByText(
      "Passport could not open the Google authorization window. Check your popup settings and try again.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(requests).toHaveLength(0);
  expect(new URL(page.url()).pathname).toBe("/authorize");
});

test("a reload of the callback page cannot resume the request a second time", async ({
  context,
  page,
}) => {
  await google(context);
  await blockPopups(page);
  await page.goto(ENTRY);
  await (
    await startPage(page)
  )
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();

  // The saved request was consumed on return: a reload is Passport's plain start page.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toHaveCount(0);
});

/** Opens the request in a Passport window of the app's own, as an integrating page does. */
async function openPassportPopup(page: Page): Promise<Page> {
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate((entry) => {
    const button = document.createElement("button");
    button.textContent = "Open Passport";
    button.onclick = () => window.open(entry, "passport", "popup,width=520,height=760");
    document.body.append(button);
  }, ENTRY);
  await page.getByRole("button", { name: "Open Passport" }).click();
  return popupPromise;
}

test("in the app's Passport window, Google opens in a window of its own by default", async ({
  context,
  page,
}) => {
  await google(context);
  const passport = await openPassportPopup(page);
  const create = await startPage(passport);
  const visited = navigations(passport);
  const googlePromise = passport.waitForEvent("popup");
  await create.getByRole("button", { name: "Continue with Google", exact: true }).click();
  const googleWindow = await googlePromise;
  await expect(passport.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  await expect.poll(() => googleWindow.isClosed()).toBe(true);
  // The app's Passport window stayed on the request the whole time.
  expect(new URL(passport.url()).pathname).toBe("/authorize");
  expect(visited).toEqual([]);
  expect(context.pages()).toHaveLength(2);
});

test("in the app's Passport window, a blocked Google window continues in that window", async ({
  context,
  page,
}) => {
  await google(context);
  // Only Passport's window is refused a further window; the app's page may open Passport.
  await context.addInitScript(() => {
    if (window.opener) window.open = () => null;
  });
  const popup = await openPassportPopup(page);
  await (
    await startPage(popup)
  )
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(popup.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  expect(new URL(popup.url()).pathname).toBe("/");
  expect(context.pages()).toHaveLength(2);
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await startPage(popup);
  expect(new URL(popup.url()).pathname).toBe("/authorize");
});
