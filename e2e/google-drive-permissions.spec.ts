import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";

const APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SUBJECT = "google-permission-test";
const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const STORAGE_ROOT = "pubky-passport/local-identities/v1";

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
    await route.fulfill({ status: 302, headers: { location: response.href } });
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
  await page.addInitScript(
    ({ publicKey, subject, root }) => {
      localStorage.setItem(
        `${root}/identity/${publicKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: publicKey,
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
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
    { publicKey: PUBLIC_KEY, subject: SUBJECT, root: STORAGE_ROOT },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Detach from Google" }).click();
  await page.getByRole("button", { name: "I backed up my pubky" }).click();
  await page.getByRole("button", { name: "Remove Google Access" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Confirm deletion" }).click();

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
