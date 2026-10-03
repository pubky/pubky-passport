import { readFile } from "node:fs/promises";
import type { AttemptEvent } from "../packages/passport-client/src/attempt/attemptModel";
import type { PassportDiagnostic } from "../packages/passport-client/src/shared/PassportDiagnostic";
import { CLIENT_RELAY_SECRET, clientAuthRequest } from "./helpers/pubkyAuthRequests";
import { test, expect, type Page } from "./helpers/passportTest";

const CLIENT = "https://client.example";
const FOREIGN = "https://foreign.example";
const ATTEMPT = "client-channel-attempt-01";
type Harness = {
  configure(origin: string, request: string): void;
  events: AttemptEvent[];
  diagnostics: PassportDiagnostic[];
  failures: number;
  dispose(): void;
};
type HarnessWindow = Window & { __channelHarness: Harness };
async function setup(page: Page, baseURL: string) {
  const passportOrigin = new URL(baseURL).origin;
  const requests: string[] = [];
  const files: Record<string, string> = {
    "/": "e2e/fixtures/passport-client/channel.html",
    "/channel.js": "e2e/fixtures/passport-client/channel.js",
    "/modules/popup/BrowserPopup.js": "packages/passport-client/dist/popup/BrowserPopup.js",
    "/modules/popup/popupFeatures.js": "packages/passport-client/dist/popup/popupFeatures.js",
    "/modules/shared/Clock.js": "packages/passport-client/dist/shared/Clock.js",
    "/modules/shared/authorizeUrl.js": "packages/passport-client/dist/shared/authorizeUrl.js",
    "/modules/shared/base64url.js": "packages/passport-client/dist/shared/base64url.js",
    "/modules/shared/requestDigest.js": "packages/passport-client/dist/shared/requestDigest.js",
    "/modules/protocol/PassportChannel.js":
      "packages/passport-client/dist/protocol/PassportChannel.js",
    "/modules/protocol/passportMessages.js":
      "packages/passport-client/dist/protocol/passportMessages.js",
  };
  await page.context().route(/https?:\/\//u, async (route) => {
    requests.push(route.request().url());
    const url = new URL(route.request().url());
    if (url.origin === passportOrigin) return route.fallback();
    if (url.origin === FOREIGN)
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Foreign page</title>",
      });
    const file =
      url.origin === CLIENT && Object.hasOwn(files, url.pathname) ? files[url.pathname] : undefined;
    if (!file) return route.abort();
    return route.fulfill({
      contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/html",
      body: await readFile(file, "utf8"),
    });
  });
  await page.goto(CLIENT);
  await page.waitForFunction(() => "__channelHarness" in window);
  await page.evaluate(
    ({ origin, request }) => {
      (window as unknown as HarnessWindow).__channelHarness.configure(origin, request);
    },
    { origin: passportOrigin, request: clientAuthRequest() },
  );
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open Passport", exact: true }).click();
  const popup = await opened;
  await expect
    .poll(async () => (await state(page)).events)
    .toContainEqual({ type: "READY", status: "valid", profileSetup: true });
  return { popup, requests };
}
function state(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as HarnessWindow).__channelHarness;
    return { events: h.events, diagnostics: h.diagnostics, failures: h.failures };
  });
}
async function send(page: Page, data: unknown) {
  await page.evaluate(
    ({ data, origin }) => {
      window.opener.postMessage(data, origin);
    },
    { data, origin: CLIENT },
  );
}
function outcome(attemptId = ATTEMPT) {
  return {
    type: "pubky-passport.authorization-outcome",
    version: 2,
    attemptId,
    messageId: "forged",
    outcome: "success",
  };
}

test("the inline channel names its bound opener and sees empty on a reloaded Passport", async ({
  page,
  baseURL,
}) => {
  const { popup, requests } = await setup(page, baseURL!);
  // A39/A40: the hello carried this request's digest, so the band names the opener.
  const band = popup.getByRole("complementary", { name: "Signing in to client.example" });
  await expect(band).toBeVisible();
  await expect(popup.getByText(/verified/iu)).toHaveCount(0);
  await popup.reload();
  await expect(popup).toHaveURL(new URL("/", baseURL!).href);
  await expect
    .poll(async () => (await state(page)).events)
    .toContainEqual({ type: "READY", status: "empty", profileSetup: true });
  const snapshot = await state(page);
  expect(snapshot.events.every((event) => event.type === "READY")).toBe(true);
  expect(snapshot.failures).toBe(0);
  expect(JSON.stringify([snapshot, requests])).not.toContain(CLIENT_RELAY_SECRET);
  await page.evaluate(() => (window as unknown as HarnessWindow).__channelHarness.dispose());
  await popup.close();
});
test("the inline channel receives cancellation and its version-matched ack closes Passport", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addInitScript((origin) => {
    if (location.origin !== origin) return;
    const key = ["tkrq8zmwb8a3m9k15csu3q17qm", "fgqnp9dskbrg9uq1rydpyxp7qy"].join("");
    const secretKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(1))).replace(/=+$/u, "");
    localStorage.setItem(
      `pubky-passport/local-identities/v1/identity/${key}`,
      JSON.stringify({ v: 1, publicKeyZ32: key, secretKey }),
    );
    localStorage.setItem("pubky-passport/local-identities/v1/active", key);
  }, new URL(baseURL!).origin);
  const { popup } = await setup(page, baseURL!);
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  const snapshot = await state(page);
  expect(snapshot.events.filter((event) => event.type === "OUTCOME")).toEqual([
    { type: "OUTCOME", outcome: "cancel", version: 2, messageId: expect.any(String) },
  ]);
  expect(snapshot.diagnostics).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain(CLIENT_RELAY_SECRET);
  await page.evaluate(() => (window as unknown as HarnessWindow).__channelHarness.dispose());
});
test("native WindowProxy events reject a foreign source, malformed reply, wrong attempt and navigated origin", async ({
  page,
  baseURL,
}) => {
  const { popup } = await setup(page, baseURL!);
  const extra = page.waitForEvent("popup");
  await page.evaluate((url) => {
    window.open(url, "foreign-source");
  }, new URL("/", baseURL!).href);
  const other = await extra;
  await other.waitForLoadState();
  await send(other, outcome());
  await expect
    .poll(async () => (await state(page)).diagnostics.map((d) => d.reason))
    .toEqual(["source"]);
  await send(popup, { ...outcome(), version: 3 });
  await expect
    .poll(async () => (await state(page)).diagnostics.map((d) => d.reason))
    .toEqual(["source", "schema"]);
  await send(popup, outcome("wrong-attempt-12345678"));
  await expect
    .poll(async () => (await state(page)).diagnostics.map((d) => d.reason))
    .toEqual(["source", "schema", "attempt"]);
  await popup.evaluate((url) => location.assign(url), FOREIGN);
  await popup.waitForURL(FOREIGN + "/");
  await popup.waitForLoadState();
  await send(popup, outcome());
  await expect
    .poll(async () => (await state(page)).diagnostics.map((d) => d.reason))
    .toEqual(["source", "schema", "attempt", "origin"]);
  const snapshot = await state(page);
  expect(snapshot.events.every((event) => event.type === "READY")).toBe(true);
  expect(snapshot.diagnostics.every((d) => d.attemptId === ATTEMPT)).toBe(true);
  await page.evaluate(() => (window as unknown as HarnessWindow).__channelHarness.dispose());
  await other.close();
  await popup.close();
});
