import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { APPLE_PORT } from "../playwright.config";
import {
  APPLE_EMAIL,
  APPLE_FIRST_NAME,
  APPLE_LAST_NAME,
  APPLE_SUBJECT,
  appleSubjectHash,
  CLOUDKIT_SESSION,
  installFakeApple,
  type StoredRecord,
} from "./support/fakeApple";
import { APPLE_BADGE, badgeOffset, expectOneBadge } from "./support/providerBadges";

const ORIGIN = `http://127.0.0.1:${APPLE_PORT}`;
const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
/** One record per Passport origin: SHA-256 of the origin, first 32 hex characters. */
const RECORD_NAME = `pubky-passport-file-v1-${createHash("sha256").update(ORIGIN).digest("hex").slice(0, 32)}`;

test.use({ baseURL: ORIGIN });

/** Everything requests carried anywhere except Apple's CloudKit API host. */
function sentOutsideCloudKit(requests: Request[]): string {
  return requests
    .filter((request) => new URL(request.url()).hostname !== "api.apple-cloudkit.com")
    .map((request) =>
      [request.url(), JSON.stringify(request.headers()), request.postData() ?? ""].join("\n"),
    )
    .join("\n");
}

/** Account screens show no Sign in with Apple button artwork and no Apple character. */
async function expectNoAppleButtonLogo(page: Page) {
  await expect(page.locator('img[src*="sign-in-with-apple"]')).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toContain("\uF8FF");
}

async function expectNoAccessibilityViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("a new user signs in with Apple, connects iCloud, and tokens only go where they belong", async ({
  context,
  page,
}, testInfo) => {
  const apple = await installFakeApple(context);
  await page.goto("/");

  await expect(page.getByText(/Use your existing accounts/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  const continueWithApple = page.getByRole("button", { name: "Continue with Apple" });
  await expect(continueWithApple).toBeEnabled();
  await expectNoAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath("apple-sign-in.png"), fullPage: true });

  // The owner requested Figma's 14px Inter Tight title and exact 16px artwork.
  const appleFont = await continueWithApple.evaluate((button) => {
    const style = getComputedStyle(button);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
  });
  expect(appleFont.family).toContain("Inter Tight");
  expect(appleFont.size).toBe("14px");
  expect(appleFont.weight).toBe("700");
  const googleBox = await page.getByRole("button", { name: "Continue with Google" }).boundingBox();
  const appleBox = await continueWithApple.boundingBox();
  expect(appleBox?.height).toBe(60);
  expect(appleBox?.width).toBe(googleBox?.width);
  const logo = continueWithApple.locator("img");
  await expect(logo).toHaveAttribute("src", "/brand/apple-logo.svg");
  const logoBox = await logo.boundingBox();
  expect(logoBox?.height).toBe(16);
  expect(logoBox?.width).toBe(16);

  const applePopup = page.waitForEvent("popup");
  // Read the URL from the request: Apple's window may already have closed after answering.
  const appleRequest = context.waitForEvent("request", (request) =>
    request.url().startsWith("https://appleid.apple.com/"),
  );
  await continueWithApple.click();
  await applePopup;
  const authorizeUrl = new URL((await appleRequest).url());
  expect(authorizeUrl.origin).toBe("https://appleid.apple.com");
  expect(authorizeUrl.searchParams.get("scope")).toBe("name email");
  // The same WindowProxy navigates to CloudKit; no second popup/click is needed.
  await expect(page.getByRole("heading", { name: "Finish in Apple's window." })).toBeVisible();
  const opened = context.pages().filter((candidate) => candidate !== page);
  expect(opened).toHaveLength(1);
  // While iCloud's popup is still open, a message from anywhere else must not become the session.
  await page.evaluate(() => window.postMessage({ ckSession: "FORGED-SESSION" }, "*"));
  await expect(page.getByRole("heading", { name: "Setup interrupted." })).toBeVisible();
  // The retry uses the same approved Apple button.

  // Passport encrypts only for an HTTPS origin, so on this HTTP test server setup stops at
  // encryption and writes nothing; the record's shape is covered by the store's unit tests.
  await expect(page.getByText(/could not encrypt it for iCloud/u)).toBeVisible();
  expect(apple.records.size).toBe(0);
  expect(apple.cloudKitCalls.map((call) => new URL(call.url).pathname)).toEqual([
    "/database/1/iCloud.app.pubky.passport.e2e/development/public/users/caller",
    "/database/1/iCloud.app.pubky.passport.e2e/development/public/users/caller",
    "/database/1/iCloud.app.pubky.passport.e2e/development/private/records/lookup",
  ]);

  // The CloudKit session only ever travelled to Apple's CloudKit host, never the forged one.
  for (const call of apple.cloudKitCalls.slice(1)) {
    expect(new URL(call.url).searchParams.get("ckWebAuthToken")).toBe(CLOUDKIT_SESSION);
  }
  const elsewhere = sentOutsideCloudKit(apple.requests);
  expect(elsewhere).not.toContain(CLOUDKIT_SESSION);
  expect(elsewhere).not.toContain("FORGED-SESSION");
  expect(await context.cookies(ORIGIN)).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  await expect(
    page.locator('script[src*="appleid.apple.com"], script[src*="apple-cloudkit.com"]'),
  ).toHaveCount(0);

  // Passport's server and Homegate only ever received the Apple ID token. That token carries
  // Apple's email claim, as Google's carries Google's; they verify it and keep nothing. The name
  // Apple shared went nowhere, and no request, not even to Apple, carries the email in the clear.
  expect(apple.wrappingKeyBodies.length).toBeGreaterThan(0);
  for (const body of [...apple.wrappingKeyBodies, ...apple.homegateBodies]) {
    expect(Object.keys(body as object)).toEqual(["appleIdToken"]);
    const payload = (body as { appleIdToken: string }).appleIdToken.split(".")[1] ?? "";
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as object;
    expect(Object.keys(claims).sort()).toEqual([
      "aud",
      "email",
      "email_verified",
      "exp",
      "iat",
      "is_private_email",
      "iss",
      "nonce",
      "sub",
    ]);
  }
  const everything = apple.requests
    .map((request) => [request.url(), request.postData() ?? ""].join("\n"))
    .join("\n");
  for (const value of [APPLE_FIRST_NAME, APPLE_LAST_NAME, APPLE_EMAIL]) {
    expect(everything).not.toContain(value);
    expect(everything).not.toContain(encodeURIComponent(value));
  }
});

test("an iCloud record from another Apple Account is reported, not decrypted", async ({
  context,
  page,
}, testInfo) => {
  const records = new Map<string, StoredRecord>([
    [
      RECORD_NAME,
      {
        recordName: RECORD_NAME,
        recordType: "PassportFile",
        recordChangeTag: "tag-existing",
        fields: {
          envelope: { value: "{}" },
          appleSub: { value: appleSubjectHash("another-apple-subject") },
        },
      },
    ],
  ]);
  const apple = await installFakeApple(context, { records });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Apple" }).click();

  await expect(
    page.getByText(/Passport key in this iCloud belongs to a different Apple Account/u),
  ).toBeVisible();
  await expect(page.getByText(`You signed in with Apple as ${APPLE_EMAIL}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Delete/u })).toHaveCount(0);
  expect(apple.wrappingKeyBodies).toEqual([]);
  expect(records.has(RECORD_NAME)).toBe(true);
  await expectNoAccessibilityViolations(page);
  await page.screenshot({
    path: testInfo.outputPath("apple-account-mismatch.png"),
    fullPage: true,
  });
});

test("an Apple identity shows its account; detach keeps it when iCloud has no record", async ({
  context,
  page,
}, testInfo) => {
  const apple = await installFakeApple(context, { closeAfterApple: true });
  await page.addInitScript(
    ({ publicKey, subject, email, name, root }) => {
      localStorage.setItem(
        `${root}/identity/${publicKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: publicKey,
          appleAccount: { appleSubject: subject, email, name },
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        }),
      );
      localStorage.setItem(`${root}/active`, publicKey);
    },
    {
      publicKey: PUBLIC_KEY,
      subject: APPLE_SUBJECT,
      email: APPLE_EMAIL,
      name: `${APPLE_FIRST_NAME} ${APPLE_LAST_NAME}`,
      root: STORAGE_ROOT,
    },
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Jane Appleseed" })).toBeVisible();
  await expect(page.getByText(APPLE_EMAIL)).toBeVisible();
  await expect(page.getByText("Apple Account", { exact: true })).toHaveCount(0);
  const overviewBadge = await expectOneBadge(page.getByRole("main"), APPLE_BADGE);
  await expect(overviewBadge.locator("xpath=following-sibling::*[1]")).toHaveText(APPLE_EMAIL);
  await expectNoAppleButtonLogo(page);
  await expectNoAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath("apple-overview.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  const appleRow = page.getByRole("button", { name: /Jane Appleseed/u });
  await expect(appleRow).toBeVisible();
  const rowBadge = await expectOneBadge(appleRow, APPLE_BADGE);
  // On the avatar's bottom-right corner, 1px in, like the Google G badge.
  expect(await badgeOffset(rowBadge, appleRow.locator("span.rounded-full").first())).toEqual({
    right: 1,
    bottom: 1,
  });
  await expectNoAppleButtonLogo(page);
  await page.screenshot({ path: testInfo.outputPath("apple-switcher.png"), fullPage: true });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  // Manage names the account type in its field label, like "Google account"; no badge there.
  await expect(page.getByText("Apple Account", { exact: true })).toBeVisible();
  await expect(page.getByText(APPLE_EMAIL)).toBeVisible();
  await expect(page.locator(APPLE_BADGE)).toHaveCount(0);
  await expectNoAppleButtonLogo(page);
  await expectNoAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath("apple-manage.png"), fullPage: true });

  await page.getByRole("button", { name: "Detach from Apple" }).click();
  await page.getByRole("button", { name: "I backed up my pubky" }).click();
  await page.getByRole("button", { name: "Remove Apple Access" }).click();
  await page.getByLabel("Type DETACH to confirm").fill("DETACH");
  await page.getByRole("button", { name: "Confirm detachment" }).click();
  await expect(page.getByText(/so Passport can delete it/u)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("apple-detach-connect.png"), fullPage: true });
  await page.getByRole("button", { name: "How Apple sign-in works" }).click();
  const detachHelp = page.getByRole("dialog");
  await expect(detachHelp).toContainText("delete its encrypted key backup from your iCloud");
  await expect(detachHelp.locator("p")).toHaveText([
    "Apple’s role: Sign in with the Apple Account that holds your encrypted backup.",
    "Your keys: Allow Passport to delete its encrypted key backup from your iCloud.",
    "Recovery: Keep a recovery file before detaching. Passport removes the iCloud backup and this browser’s copy.",
    "After detaching: Apple sign-in can no longer restore this pubky.",
  ]);
  await page.screenshot({ path: testInfo.outputPath("apple-detach-help.png"), fullPage: true });
  await detachHelp.getByRole("button", { name: "Continue with Apple" }).click();
  await expect(detachHelp).toBeHidden();

  // An empty iCloud may belong to another account, so it never counts as a confirmed delete.
  await expect(page.getByText(/This iCloud has no Passport key for this identity/u)).toBeVisible();
  await expectNoAppleButtonLogo(page);
  await page.screenshot({ path: testInfo.outputPath("apple-detach-missing.png"), fullPage: true });
  expect(
    await page.evaluate(
      ({ root, publicKey }) => localStorage.getItem(`${root}/identity/${publicKey}`),
      { root: STORAGE_ROOT, publicKey: PUBLIC_KEY },
    ),
  ).not.toBeNull();
  expect(sentOutsideCloudKit(apple.requests)).not.toContain(CLOUDKIT_SESSION);
  expect(await context.cookies(ORIGIN)).toEqual([]);
});
