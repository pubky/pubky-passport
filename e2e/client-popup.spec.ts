import { readFile } from "node:fs/promises";
import { CLIENT_RELAY_SECRET, clientAuthRequest } from "./helpers/pubkyAuthRequests";
import { test, expect, type Page } from "./helpers/passportTest";
import { UNVERIFIED_BAND, UNVERIFIED_HEADING } from "./helpers/requester";

const CLIENT = "https://client.example";
type Harness = {
  configure(origin: string, request: string, prepared: boolean): void;
  navigate(): boolean;
  focus(): void;
  close(): void;
  dispose(): void;
  closed: number;
  failures: number;
};
type HarnessWindow = Window & { __popupHarness: Harness };
async function setup(page: Page, baseURL: string, prepared: boolean) {
  const passportOrigin = new URL(baseURL).origin;
  const requests: string[] = [];
  const files: Record<string, string> = {
    "/": "e2e/fixtures/passport-client/popup.html",
    "/popup.js": "e2e/fixtures/passport-client/popup.js",
    "/modules/popup/BrowserPopup.js": "packages/passport-client/dist/popup/BrowserPopup.js",
    "/modules/popup/openPassportPopup.js":
      "packages/passport-client/dist/popup/openPassportPopup.js",
    "/modules/popup/popupFeatures.js": "packages/passport-client/dist/popup/popupFeatures.js",
    "/modules/shared/Clock.js": "packages/passport-client/dist/shared/Clock.js",
    "/modules/shared/authorizeUrl.js": "packages/passport-client/dist/shared/authorizeUrl.js",
  };
  await page.context().route(/https?:\/\//u, async (route) => {
    requests.push(route.request().url());
    const url = new URL(route.request().url());
    if (url.origin === passportOrigin) return route.fallback();
    const file =
      url.origin === CLIENT && Object.hasOwn(files, url.pathname) ? files[url.pathname] : undefined;
    if (!file) return route.abort();
    return route.fulfill({
      contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/html",
      body: await readFile(file, "utf8"),
    });
  });
  await page.goto(CLIENT);
  await page.waitForFunction(() => "__popupHarness" in window);
  await page.evaluate(
    ({ origin, request, prepared }) => {
      (window as unknown as HarnessWindow).__popupHarness.configure(origin, request, prepared);
    },
    { origin: passportOrigin, request: clientAuthRequest(), prepared },
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open Passport", exact: true }).click();
  return { popup: await popup, requests };
}

test("a synchronous blank popup displays text, navigates to Passport and permits safe cross-origin focus/close", async ({
  page,
  baseURL,
}) => {
  const { popup, requests } = await setup(page, baseURL!, false);
  await expect(popup).toHaveTitle("Opening Passport…");
  await expect(popup.locator("body")).toHaveText("Opening Passport…");
  expect(await popup.evaluate(() => window.name)).toBe("pubky-passport-client-popup-attempt-001");
  expect(
    await page.evaluate(() => (window as unknown as HarnessWindow).__popupHarness.navigate()),
  ).toBe(true);
  await expect(popup).toHaveURL(new URL("/authorize", baseURL!).href);
  // M3: without a hello nothing names the requester, and the band says Passport can't tell.
  await expect(popup.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  await expect(popup.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  await page.evaluate(() => {
    const h = (window as unknown as HarnessWindow).__popupHarness;
    h.focus();
    h.close();
  });
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__popupHarness.closed))
    .toBe(1);
  expect(JSON.stringify(requests)).not.toContain(CLIENT_RELAY_SECRET);
  expect(
    await page.evaluate(() => (window as unknown as HarnessWindow).__popupHarness.failures),
  ).toBe(0);
});

test("a prepared popup opens the fragment directly and native user closure is detected", async ({
  page,
  baseURL,
}) => {
  const { popup, requests } = await setup(page, baseURL!, true);
  await expect(popup).toHaveURL(new URL("/authorize", baseURL!).href);
  // M3: without a hello nothing names the requester, and the band says Passport can't tell.
  await expect(popup.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  await expect(popup.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  expect(await popup.evaluate(() => window.name)).toBe("pubky-passport-client-popup-attempt-001");
  await popup.close();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__popupHarness.closed))
    .toBe(1);
  await page.evaluate(() => (window as unknown as HarnessWindow).__popupHarness.dispose());
  expect(JSON.stringify(requests)).not.toContain(CLIENT_RELAY_SECRET);
});
