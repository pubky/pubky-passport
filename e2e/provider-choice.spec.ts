import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { APPLE_PORT } from "../playwright.config";
import { APPLE_AUTHORIZE, APPLE_EMAIL, APPLE_SUBJECT, installFakeApple } from "./support/fakeApple";

/** Passport with Apple login on; the default server has it off. */
const APPLE_ORIGIN = `http://127.0.0.1:${APPLE_PORT}`;
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const REQUEST = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client&x-cancel=https%3A%2F%2Fclient.example%2Fcancel`;
const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const GOOGLE_KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
const APPLE_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";

function entry(providerHint: string, origin = APPLE_ORIGIN): string {
  return `${origin}/authorize#d=${encodeURIComponent(REQUEST)}&x-provider=${providerHint}`;
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

test("x-provider=google goes straight to Google in the same tab, even with Apple on", async ({
  context,
  page,
}) => {
  const google = await fakeGoogle(context);
  const popups = countPopups(page);

  await page.goto(entry("google"));

  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//u);
  await expect(page.getByRole("heading", { name: "Google", exact: true })).toBeVisible();
  expect(google).toHaveLength(1);
  expect(google[0]!.href).not.toContain(SECRET);
  expect(popups.count).toBe(0);
});

test("x-provider=apple shows only Apple's step and opens Apple's window only from the click", async ({
  context,
  page,
}, testInfo) => {
  const apple = await installFakeApple(context);
  const google = await fakeGoogle(context);
  const popups = countPopups(page);

  await page.goto(entry("apple"));

  await expect(page.getByText(/Use your Apple Account to sign in/u)).toBeVisible();
  await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  const continueWithApple = page.getByRole("button", { name: "Continue with Apple" });
  await expect(continueWithApple).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("provider-apple.png"), fullPage: true });
  // Nothing opened by itself: no popup, no Apple or Google request, the address bar scrubbed.
  expect(popups.count).toBe(0);
  expect(google).toHaveLength(0);
  expect(apple.requests.filter((request) => request.url().includes("appleid.apple.com"))).toEqual(
    [],
  );
  expect(page.url()).toBe(`${APPLE_ORIGIN}/authorize`);

  const applePopup = page.waitForEvent("popup");
  await continueWithApple.click();
  await applePopup;
  await expect(page.getByRole("heading", { name: "Connect iCloud." })).toBeVisible();
  expect(
    apple.requests.filter((request) => request.url().startsWith(`${APPLE_AUTHORIZE}?`)),
  ).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Connect iCloud" })).toBeEnabled();
  expect(popups.count).toBe(1);
});

test("x-provider=apple keeps Google one click away and Back cancels the request", async ({
  context,
  page,
}) => {
  await installFakeApple(context);
  await context.route("https://client.example/cancel", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Cancelled</h1>" }),
  );

  await page.goto(entry("apple"));
  await page.getByRole("button", { name: "Other sign-in options" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible();
});

for (const value of ["facebook", "APPLE", ""]) {
  test(`an unknown x-provider value (${JSON.stringify(value)}) shows the normal choice`, async ({
    context,
    page,
  }) => {
    const google = await fakeGoogle(context);
    await page.goto(entry(value));

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
    await expect(page.getByText(/Use your Google Account or Apple Account/u)).toBeVisible();
    expect(google).toHaveLength(0);
  });
}

test("x-provider=apple where Apple is off waits on Google's button instead of redirecting", async ({
  context,
  page,
}) => {
  const google = await fakeGoogle(context);

  await page.goto(entry("apple", ""));

  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
  expect(google).toHaveLength(0);
});

test("with existing identities, x-provider picks that provider's identity and still asks to authorize", async ({
  context,
  page,
}) => {
  await installFakeApple(context);
  const google = await fakeGoogle(context);
  await page.addInitScript(
    ({ root, googleKey, appleKey, subject, email }) => {
      const secretKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
      localStorage.setItem(
        `${root}/identity/${googleKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: googleKey,
          googleAccount: {
            googleSubject: "google-e2e",
            email: "google-user@example.com",
            name: "Google User",
            pictureUrl: null,
          },
          secretKey,
        }),
      );
      localStorage.setItem(
        `${root}/identity/${appleKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: appleKey,
          appleAccount: { appleSubject: subject, email, name: "Apple User" },
          secretKey,
        }),
      );
      localStorage.setItem(`${root}/active`, googleKey);
    },
    {
      root: STORAGE_ROOT,
      googleKey: GOOGLE_KEY,
      appleKey: APPLE_KEY,
      subject: APPLE_SUBJECT,
      email: APPLE_EMAIL,
    },
  );
  const popups = countPopups(page);

  await page.goto(entry("apple"));

  await expect(page.getByRole("heading", { name: "Sign in to Client" })).toBeVisible();
  await expect(page.getByText("Apple User")).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Switch" })).toBeVisible();
  // Shown for this request only: the saved active identity is unchanged.
  expect(await page.evaluate((root) => localStorage.getItem(`${root}/active`), STORAGE_ROOT)).toBe(
    GOOGLE_KEY,
  );

  // A new request with google shows the Google identity: each request follows its own hint.
  await page.goto("about:blank");
  await page.goto(entry("google"));
  await expect(page.getByRole("heading", { name: "Sign in to Client" })).toBeVisible();
  await expect(page.getByText("Google User")).toBeVisible();
  expect(google).toHaveLength(0);
  expect(popups.count).toBe(0);
});
