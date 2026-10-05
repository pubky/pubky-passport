import { readFile } from "node:fs/promises";
import type { PassportMessage } from "../packages/passport-client/src/protocol/passportMessages";
import {
  CLIENT_RELAY_SECRET,
  clientAuthRequest,
  clientAuthorizationPath,
} from "./helpers/pubkyAuthRequests";
import { test, expect, type Page, type BrowserContext } from "./helpers/passportTest";

const CLIENT = "https://client.example";
type Harness = { open(url: string): void; hello(): void; ack(): void; messages: PassportMessage[] };
type HarnessWindow = Window & { __wireHarness: Harness };
async function open(page: Page, baseURL: string, path: string) {
  const origin = new URL(baseURL).origin;
  await page.context().route(/https?:\/\//u, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.fallback();
    if (url.origin !== CLIENT) return route.abort();
    const source =
      url.pathname === "/modules/protocol/passportMessages.js"
        ? "packages/passport-client/dist/protocol/passportMessages.js"
        : url.pathname === "/modules/shared/requestDigest.js"
          ? "packages/passport-client/dist/shared/requestDigest.js"
          : url.pathname === "/modules/shared/base64url.js"
            ? "packages/passport-client/dist/shared/base64url.js"
            : url.pathname === "/wire-schema.js"
              ? "e2e/fixtures/passport-client/wire-schema.js"
              : url.pathname === "/"
                ? "e2e/fixtures/passport-client/wire-schema.html"
                : undefined;
    if (!source) return route.abort();
    return route.fulfill({
      contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/html",
      body: await readFile(source, "utf8"),
    });
  });
  await page.goto(CLIENT);
  await page.waitForFunction(() => "__wireHarness" in window);
  const popup = page.waitForEvent("popup");
  await page.evaluate(
    (url) => (window as unknown as HarnessWindow).__wireHarness.open(url),
    new URL(path, baseURL).href,
  );
  return popup;
}
async function messages(page: Page) {
  return page.evaluate(() => (window as unknown as HarnessWindow).__wireHarness.messages);
}
async function ready(page: Page, request: object) {
  await expect
    .poll(async () => {
      await page.evaluate(() => (window as unknown as HarnessWindow).__wireHarness.hello());
      return (await messages(page)).at(-1);
    })
    .toMatchObject({ type: "pubky-passport.ready", version: 2, request });
  expect(JSON.stringify(await messages(page))).not.toContain(CLIENT_RELAY_SECRET);
}
async function seedIdentity(context: BrowserContext, baseURL: string) {
  await context.addInitScript((origin) => {
    if (location.origin !== origin) return;
    const key = ["tkrq8zmwb8a3m9k15csu3q17qm", "fgqnp9dskbrg9uq1rydpyxp7qy"].join("");
    const secretKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(1))).replace(/=+$/u, "");
    localStorage.setItem(
      `pubky-passport/local-identities/v1/identity/${key}`,
      JSON.stringify({ v: 1, publicKeyZ32: key, secretKey }),
    );
    localStorage.setItem("pubky-passport/local-identities/v1/active", key);
  }, new URL(baseURL).origin);
}

for (const [name, path, request] of [
  ["valid", clientAuthorizationPath(clientAuthRequest()), { status: "valid" }],
  ["invalid", "/authorize?d=invalid", { status: "invalid", code: "invalid_search" }],
  ["empty", "/", { status: "empty" }],
] as const) {
  test(`the client schema accepts Passport's actual ${name} ready`, async ({ page, baseURL }) => {
    const popup = await open(page, baseURL!, path);
    await ready(page, request);
    await popup.close();
  });
}
test("the client schema accepts a real v2 cancellation and its ack closes Passport", async ({
  page,
  context,
  baseURL,
}) => {
  await seedIdentity(context, baseURL!);
  const popup = await open(page, baseURL!, clientAuthorizationPath(clientAuthRequest()));
  await ready(page, { status: "valid" });
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(async () =>
      (await messages(page)).find(
        (message) => message.type === "pubky-passport.authorization-outcome",
      ),
    )
    .toMatchObject({ version: 2, outcome: "cancel" });
  await page.evaluate(() => (window as unknown as HarnessWindow).__wireHarness.ack());
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(JSON.stringify(await messages(page))).not.toContain(CLIENT_RELAY_SECRET);
});
test("the client schema accepts completed after a terminal action before the first hello", async ({
  page,
  context,
  baseURL,
}) => {
  await seedIdentity(context, baseURL!);
  const popup = await open(page, baseURL!, clientAuthorizationPath(clientAuthRequest()));
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Sign-in cancelled." })).toBeVisible();
  await ready(page, { status: "completed" });
  expect((await messages(page)).every((message) => message.type === "pubky-passport.ready")).toBe(
    true,
  );
  await popup.close();
});
