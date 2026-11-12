import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";

import { APPLE_PORT } from "../playwright.config";
import { APPLE_EMAIL, installFakeApple } from "./support/fakeApple";
import {
  GOOGLE_EMAIL,
  GOOGLE_SUBJECT,
  HTTPS_ORIGIN,
  installFakeGoogle,
  passportFile,
  serveOverHttps,
} from "./support/fakeGoogle";

const GOOGLE_SERVER = `http://127.0.0.1:${APPLE_PORT - 1}`;
const APPLE_SERVER = `http://127.0.0.1:${APPLE_PORT}`;
const ROOT = "pubky-passport/local-identities/v1";
/** Two real key pairs: the stored secret must derive the pubky, or Passport refuses to upload it. */
const FIRST = {
  publicKeyZ32: "orhzqdiexwmi6iidktucgud63ufa5nwtsuzdxe176a8izd6jsqky",
  secretKey: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
};
const SECOND = {
  publicKeyZ32: "7ir1ttte48bcp4zjychjyscicrwi1j34mtt91ptsafdbjmr8g9eo",
  secretKey: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
};

type Identity = typeof FIRST;

/** Replaces this browser's identities with browser-only copies of `identities`. */
async function storeBrowserOnly(page: Page, ...identities: Identity[]) {
  await page.evaluate(
    ({ root, identities }) => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(root)) localStorage.removeItem(key);
      }
      for (const identity of identities) {
        localStorage.setItem(
          `${root}/identity/${identity.publicKeyZ32}`,
          JSON.stringify({ v: 1, ...identity }),
        );
      }
      localStorage.setItem(`${root}/active`, identities[0]!.publicKeyZ32);
    },
    { root: ROOT, identities },
  );
  await page.reload();
}

async function storedRecord(page: Page, identity: Identity) {
  const value = await page.evaluate(({ key }) => localStorage.getItem(key), {
    key: `${ROOT}/identity/${identity.publicKeyZ32}`,
  });
  return value === null ? null : (JSON.parse(value) as Record<string, unknown>);
}

async function openManage(page: Page) {
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
}

async function expectAccessibleAndFitting(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

/** Requests to Passport's own server, Homegate and any homeserver or PKARR relay. */
function trackServerRequests(context: BrowserContext) {
  const requests: Request[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (
      (url.origin === HTTPS_ORIGIN && url.pathname.startsWith("/api/")) ||
      url.hostname === "homegate.example" ||
      url.hostname.startsWith("pkarr.") ||
      url.hostname === "homeserver.example"
    ) {
      requests.push(request);
    }
  });
  return requests;
}

async function attachWithGoogle(page: Page) {
  await page.getByRole("button", { name: "Connect Google" }).click();
  await expect(page.getByRole("heading", { name: "Connect an account." })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
}

test.describe("attach with Google", () => {
  test("stores the pubky in Drive, shows the account, and Detach removes it again", async ({
    context,
    page,
  }, testInfo) => {
    await serveOverHttps(context, GOOGLE_SERVER);
    const google = await installFakeGoogle(context);
    const serverRequests = trackServerRequests(context);
    await page.goto(HTTPS_ORIGIN);
    await storeBrowserOnly(page, FIRST);
    await openManage(page);

    await expect(page.getByText("Not connected")).toBeVisible();
    // Apple login is off on this server: only Google is offered.
    await expect(page.getByRole("button", { name: "Connect Google" })).toBeVisible();
    await expectAccessibleAndFitting(page);
    await page.screenshot({ path: testInfo.outputPath("manage-entry.png"), fullPage: true });

    await page.getByRole("button", { name: "Connect Google" }).click();
    await expect(page.getByRole("heading", { name: "Connect an account." })).toBeVisible();
    await expect(page.getByText(FIRST.publicKeyZ32)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "How Google sign-in works" })).toBeVisible();
    await expect(page.getByText(/By continuing, you agree to the Pubky Passport/u)).toBeVisible();
    await expectAccessibleAndFitting(page);
    await page.screenshot({ path: testInfo.outputPath("attach-choice.png"), fullPage: true });

    serverRequests.length = 0;
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("heading", { name: "Connected to Google." })).toBeVisible();
    await expect(page.getByText("Stored backup in Google Drive.")).toBeVisible();
    await expect(page.getByText(GOOGLE_EMAIL)).toBeVisible();
    await expectAccessibleAndFitting(page);
    await page.screenshot({ path: testInfo.outputPath("attach-success.png"), fullPage: true });

    // The Drive file and the visible copy hold an envelope for this origin, never the key. It is
    // marked attached, so a later restore never signs this pubky up on Passport's homeserver.
    const file = passportFile(google);
    expect(file?.name).toBe("passport.json");
    const envelope = JSON.parse(file?.content ?? "{}") as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(["attached", "ct", "iv", "keyId", "url", "v"]);
    expect(envelope.attached).toBe(true);
    expect(envelope.url).toBe(HTTPS_ORIGIN);
    const copy = [...google.files.values()].find(
      (candidate) => candidate.name === `${FIRST.publicKeyZ32}.json`,
    );
    expect(copy?.content).toBe(file?.content);
    for (const stored of google.files.values()) {
      expect(stored.content ?? "").not.toContain(FIRST.secretKey);
    }
    // Only the wrapping-key request a setup makes reached Passport's server; no Homegate, no
    // homeserver, no PKARR.
    expect(serverRequests.map((request) => new URL(request.url()).pathname)).toEqual([
      "/api/wrapping-key/google",
    ]);
    expect(google.wrappingKeyBodies.map((body) => Object.keys(body as object))).toEqual([
      ["googleIdToken"],
    ]);

    // The local record keeps its key and now names the Google account.
    const record = await storedRecord(page, FIRST);
    expect(record?.secretKey).toBe(FIRST.secretKey);
    expect(record?.googleAccount).toMatchObject({
      googleSubject: GOOGLE_SUBJECT,
      email: GOOGLE_EMAIL,
    });

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
    await expect(page.getByText("Google account", { exact: true })).toBeVisible();
    await expect(page.getByText(GOOGLE_EMAIL)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Connect/u })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("manage-after.png"), fullPage: true });

    // Detach works on the attached identity: Drive files and this browser's copy go.
    await page.getByRole("button", { name: "Detach from Google" }).click();
    await page.getByRole("button", { name: "I backed up my pubky" }).click();
    await page.getByRole("button", { name: "Remove Google Access" }).click();
    await page.getByLabel("Type DETACH to confirm").fill("DETACH");
    await page.getByRole("button", { name: "Confirm detachment" }).click();
    await expect(page.getByRole("heading", { name: "Detached from Google." })).toBeVisible();
    expect(passportFile(google)).toBeUndefined();
    expect([...google.files.values()].filter((stored) => stored.name.endsWith(".json"))).toEqual(
      [],
    );
    expect(await storedRecord(page, FIRST)).toBeNull();
  });

  test("links a Drive that already holds this pubky, also after a create conflict", async ({
    context,
    page,
  }) => {
    await serveOverHttps(context, GOOGLE_SERVER);
    const google = await installFakeGoogle(context);
    google.appDataOnly = true;
    await page.goto(HTTPS_ORIGIN);
    await storeBrowserOnly(page, FIRST);
    await openManage(page);
    await attachWithGoogle(page);
    await expect(page.getByRole("heading", { name: "Connected to Google." })).toBeVisible();
    // Without the second permission there is no visible copy, and the screen says so.
    await expect(page.getByRole("status")).toContainText("No visible recovery copy");
    const original = passportFile(google)!;

    // This browser forgets the link; Drive still holds this pubky.
    await storeBrowserOnly(page, FIRST);
    await openManage(page);
    const before = google.driveCalls.length;
    await attachWithGoogle(page);
    await expect(
      page.getByText("Google Drive already held the backup of this pubky."),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(google.driveCalls.slice(before).filter((call) => !call.startsWith("GET"))).toEqual([]);
    expect(passportFile(google)).toEqual(original);
    expect((await storedRecord(page, FIRST))?.googleAccount).toBeDefined();

    // Another device writes the same pubky while this one is about to: read again, then link.
    google.files.clear();
    await storeBrowserOnly(page, FIRST);
    await openManage(page);
    // The first listing finds nothing; the store's own check before creating sees the file.
    let lists = 0;
    google.beforeAppDataList = () => {
      lists += 1;
      if (lists === 2) google.files.set(original.id, original);
    };
    const conflictStart = google.driveCalls.length;
    await attachWithGoogle(page);
    await expect(
      page.getByText("Google Drive already held the backup of this pubky."),
    ).toBeVisible();
    expect(
      google.driveCalls.slice(conflictStart).filter((call) => !call.startsWith("GET")),
    ).toEqual([]);
    expect(lists).toBeGreaterThanOrEqual(3);
  });

  test("refuses an account that holds another pubky and changes nothing", async ({
    context,
    page,
  }, testInfo) => {
    await serveOverHttps(context, GOOGLE_SERVER);
    const google = await installFakeGoogle(context);
    google.appDataOnly = true;
    await page.goto(HTTPS_ORIGIN);
    // The second pubky is backed up to this Google account first.
    await storeBrowserOnly(page, SECOND);
    await openManage(page);
    await attachWithGoogle(page);
    await expect(page.getByRole("heading", { name: "Connected to Google." })).toBeVisible();
    const held = structuredClone(passportFile(google)!);

    await storeBrowserOnly(page, FIRST);
    await openManage(page);
    const before = google.driveCalls.length;
    await attachWithGoogle(page);

    await expect(page.getByRole("heading", { name: "Account in use." })).toBeVisible();
    await expect(page.getByText(/This Google account already holds another pubky/u)).toBeVisible();
    await expect(page.getByText(/Detach that pubky from Google first/u)).toBeVisible();
    await expect(page.getByText(/Nothing was changed/u)).toBeVisible();
    await expectAccessibleAndFitting(page);
    await page.screenshot({ path: testInfo.outputPath("attach-refused.png"), fullPage: true });
    // Nothing created, replaced or deleted; the other pubky's file is intact.
    expect(google.driveCalls.slice(before).filter((call) => !call.startsWith("GET"))).toEqual([]);
    expect(passportFile(google)).toEqual(held);
    expect((await storedRecord(page, FIRST))?.googleAccount).toBeUndefined();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Connect an account." })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Not connected")).toBeVisible();
  });

  test("Back and a closed Google window leave the identity browser-only", async ({
    context,
    page,
  }) => {
    await serveOverHttps(context, GOOGLE_SERVER);
    const google = await installFakeGoogle(context);
    await page.goto(HTTPS_ORIGIN);
    await storeBrowserOnly(page, FIRST);
    await openManage(page);

    await page.getByRole("button", { name: "Connect Google" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Not connected")).toBeVisible();

    // The person closes Google's window without granting anything.
    await context.route("https://accounts.google.com/o/oauth2/v2/auth**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><script>close()</script>" }),
    );
    await attachWithGoogle(page);
    await expect(page.getByRole("heading", { name: "Not connected." })).toBeVisible();
    await expect(page.getByText("google_authorization_popup_closed")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Not connected")).toBeVisible();
    expect(google.driveCalls).toEqual([]);
    expect(google.wrappingKeyBodies).toEqual([]);
    expect((await storedRecord(page, FIRST))?.googleAccount).toBeUndefined();
  });

  test("an identity with a sign-in account shows no attach entry", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(
      ({ root, identity }) => {
        localStorage.setItem(
          `${root}/identity/${identity.publicKeyZ32}`,
          JSON.stringify({
            v: 1,
            ...identity,
            googleAccount: {
              googleSubject: "linked",
              email: "linked@example.com",
              name: "Linked",
              pictureUrl: null,
            },
          }),
        );
        localStorage.setItem(`${root}/active`, identity.publicKeyZ32);
      },
      { root: ROOT, identity: FIRST },
    );
    await page.reload();
    await openManage(page);
    await expect(page.getByRole("button", { name: "Detach from Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Connect/u })).toHaveCount(0);
  });
});

test.describe("attach with Apple", () => {
  test("stores the pubky in iCloud after both Apple steps, without Homegate", async ({
    context,
    page,
  }, testInfo) => {
    await serveOverHttps(context, APPLE_SERVER);
    const apple = await installFakeApple(context);
    const serverRequests = trackServerRequests(context);
    await page.goto(HTTPS_ORIGIN);
    await storeBrowserOnly(page, FIRST);
    await openManage(page);

    await page.getByRole("button", { name: "Connect Google or Apple" }).click();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    const continueWithApple = page.getByRole("button", { name: "Continue with Apple" });
    await expect(continueWithApple).toBeEnabled();
    await expectAccessibleAndFitting(page);
    await page.screenshot({ path: testInfo.outputPath("apple-choice.png"), fullPage: true });

    serverRequests.length = 0;
    await continueWithApple.click();
    await expect(page.getByRole("heading", { name: "Connected to Apple." })).toBeVisible();
    await expect(page.getByText("Stored backup in iCloud.")).toBeVisible();
    expect(apple.records.size).toBe(1);
    expect(apple.homegateBodies).toEqual([]);
    expect(serverRequests.map((request) => new URL(request.url()).pathname)).toEqual([
      "/api/wrapping-key/apple",
    ]);
    const record = await storedRecord(page, FIRST);
    expect(record?.secretKey).toBe(FIRST.secretKey);
    expect(record?.appleAccount).toMatchObject({ email: APPLE_EMAIL });

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Apple Account", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Detach from Apple" })).toBeVisible();
  });

  test("refuses an Apple Account whose iCloud holds another pubky", async ({ context, page }) => {
    await serveOverHttps(context, APPLE_SERVER);
    const apple = await installFakeApple(context);
    await page.goto(HTTPS_ORIGIN);
    await storeBrowserOnly(page, SECOND);
    await openManage(page);
    await page.getByRole("button", { name: "Connect Google or Apple" }).click();
    await page.getByRole("button", { name: "Continue with Apple" }).click();
    await expect(page.getByRole("heading", { name: "Connected to Apple." })).toBeVisible();
    const held = structuredClone([...apple.records.values()]);

    await storeBrowserOnly(page, FIRST);
    await openManage(page);
    const before = apple.cloudKitCalls.length;
    await page.getByRole("button", { name: "Connect Google or Apple" }).click();
    await page.getByRole("button", { name: "Continue with Apple" }).click();

    await expect(page.getByRole("heading", { name: "Account in use." })).toBeVisible();
    await expect(page.getByText(/This Apple Account already holds another pubky/u)).toBeVisible();
    await expect(page.getByText(`You signed in with Apple as ${APPLE_EMAIL}.`)).toBeVisible();
    expect(
      apple.cloudKitCalls.slice(before).filter((call) => call.url.includes("/records/modify")),
    ).toEqual([]);
    expect([...apple.records.values()]).toEqual(held);
    expect((await storedRecord(page, FIRST))?.appleAccount).toBeUndefined();
  });

  test("going back from Connect iCloud changes nothing", async ({ context, page }) => {
    await serveOverHttps(context, APPLE_SERVER);
    const apple = await installFakeApple(context, { closeAfterApple: true });
    await page.goto(HTTPS_ORIGIN);
    await storeBrowserOnly(page, FIRST);
    await openManage(page);
    await page.getByRole("button", { name: "Connect Google or Apple" }).click();
    await page.getByRole("button", { name: "Continue with Apple" }).click();

    await expect(page.getByText("Step 2 of 2: connect to iCloud")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Connect an account." })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Not connected")).toBeVisible();
    expect(apple.records.size).toBe(0);
    expect(apple.wrappingKeyBodies).toEqual([]);
    expect((await storedRecord(page, FIRST))?.appleAccount).toBeUndefined();
  });
});
