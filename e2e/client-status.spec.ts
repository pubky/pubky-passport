import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PassportState } from "../packages/passport-client/src/attempt/attemptModel";
import { clientAuthRequest } from "./helpers/pubkyAuthRequests";
import { test, expect, type Page } from "./helpers/passportTest";

const CLIENT = "https://client.example";
type Harness = {
  configure(origin: string, url: string): void;
  state(): PassportState;
  advance(ms: number): void;
  approve(): void;
  dispose(): void;
  events: { type: string; phase?: string; status?: string }[];
  deliveries: number;
  flowFrees: number;
  sessionFrees: number;
  signouts: number;
  result?: string;
  timeouts: { closedGraceMs: number; ringGraceMs: number };
};
type HarnessWindow = Window & { __attemptStatus: Harness };

async function setup(page: Page, baseURL: string, identity: "local" | "ring" | "none") {
  const passportOrigin = new URL(baseURL).origin;
  const directory = "packages/passport-client/dist";
  const files = new Map([
    ["/", "e2e/fixtures/passport-client/attempt-status.html"],
    ["/attempt-status.js", "e2e/fixtures/passport-client/attempt-status.js"],
  ]);
  for (const path of await readdir(directory, { recursive: true }))
    if (path.endsWith(".js")) files.set(`/modules/${path}`, join(directory, path));
  await page.context().route(/https?:\/\//u, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === passportOrigin) return route.fallback();
    const file = url.origin === CLIENT ? files.get(url.pathname) : undefined;
    if (!file) return route.abort();
    return route.fulfill({
      contentType: file.endsWith(".js") ? "text/javascript" : "text/html",
      body: await readFile(file, "utf8"),
    });
  });
  await page.context().addInitScript(
    ({ origin, identity }) => {
      if (location.origin !== origin || identity === "none") return;
      const key = ["tkrq8zmwb8a3m9k15csu3q17qm", "fgqnp9dskbrg9uq1rydpyxp7qy"].join("");
      const fields =
        identity === "ring"
          ? { keySource: "ring" }
          : {
              secretKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))).replace(
                /=+$/u,
                "",
              ),
            };
      localStorage.setItem(
        `pubky-passport/local-identities/v1/identity/${key}`,
        JSON.stringify({ v: 1, publicKeyZ32: key, ...fields }),
      );
      localStorage.setItem("pubky-passport/local-identities/v1/active", key);
    },
    { origin: passportOrigin, identity },
  );
  await page.goto(CLIENT);
  await page.waitForFunction(() => "__attemptStatus" in window);
  await page.evaluate(
    ({ origin, request }) => {
      (window as unknown as HarnessWindow).__attemptStatus.configure(origin, request);
    },
    { origin: passportOrigin, request: clientAuthRequest() },
  );
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open Passport" }).click();
  const popup = await opened;
  await expect
    .poll(async () => (await snapshot(page)).state)
    .toMatchObject({
      status: "waiting",
      handshake: "confirmed",
    });
  return popup;
}
function snapshot(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as HarnessWindow).__attemptStatus;
    const state = h.state();
    return {
      state: { ...state, ...("error" in state ? { error: { code: state.error.code } } : {}) },
      events: h.events,
      deliveries: h.deliveries,
      result: h.result,
      flowFrees: h.flowFrees,
      sessionFrees: h.sessionFrees,
      signouts: h.signouts,
    };
  });
}
async function approve(page: Page) {
  await page.evaluate(() => (window as unknown as HarnessWindow).__attemptStatus.approve());
  await expect.poll(async () => (await snapshot(page)).state.status).toBe("signed-in");
  expect(await snapshot(page)).toMatchObject({
    deliveries: 1,
    result: "signed-in",
    flowFrees: 1,
    signouts: 0,
  });
  await page.evaluate(() => (window as unknown as HarnessWindow).__attemptStatus.dispose());
  expect((await snapshot(page)).sessionFrees).toBe(1);
}

for (const identity of ["local", "ring", "none"] as const) {
  // One saved identity Passport can sign with opens on its review, whose "or" offers the keychain;
  // with none saved, or only one whose key stays in Ring, the start page's Join offers it under
  // its cards: the harness's hello does not say the app offers a keychain route of its own.
  const action = identity === "local" ? "Continue with keychain" : "Use Pubky Ring or Bitkit";
  test(`${identity}: the explicit Ring action reports phase; the app closes Passport once it has the Session`, async ({
    page,
    baseURL,
  }) => {
    const popup = await setup(page, baseURL!, identity);
    await expect(popup.getByRole("button", { name: action, exact: true })).toBeVisible();
    expect((await snapshot(page)).events.every((event) => event.type === "READY")).toBe(true);
    await popup.getByRole("button", { name: action, exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page)).state)
      .toMatchObject({ status: "waiting", phase: "ring" });
    // Nobody reports the approval: the Ring screen stays, with Back, until the app has its Session.
    await expect(popup.getByRole("heading", { name: "Sign in with keychain." })).toBeVisible();
    await expect(popup.getByRole("button", { name: /approved|Back to /u })).toHaveCount(0);
    expect((await snapshot(page)).events.filter((event) => event.type === "OUTCOME")).toEqual([]);
    expect((await snapshot(page)).deliveries).toBe(0);
    expect(popup.isClosed()).toBe(false);
    await approve(page);
    await expect.poll(() => popup.isClosed()).toBe(true);
  });

  if (identity === "none") continue;
  test(`${identity}: closing from Ring retains the longer grace and delivers the Session`, async ({
    page,
    baseURL,
  }) => {
    const popup = await setup(page, baseURL!, identity);
    await popup.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).state).toMatchObject({ phase: "ring" });
    await popup.close();
    await expect
      .poll(async () => (await snapshot(page)).state)
      .toMatchObject({ window: "closed", phase: "ring" });
    await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__attemptStatus;
      h.advance(h.timeouts.closedGraceMs + 1);
    });
    expect((await snapshot(page)).state).toMatchObject({ status: "waiting", phase: "ring" });
    expect((await snapshot(page)).result).toBeUndefined();
    await approve(page);
  });
}

test("a normal popup close expires at the shorter grace", async ({ page, baseURL }) => {
  const popup = await setup(page, baseURL!, "none");
  await popup.close();
  await expect.poll(async () => (await snapshot(page)).state).toMatchObject({ window: "closed" });
  await page.evaluate(() => {
    const h = (window as unknown as HarnessWindow).__attemptStatus;
    h.advance(h.timeouts.closedGraceMs);
  });
  expect((await snapshot(page)).state).toMatchObject({
    status: "failed",
    error: { code: "popup_closed" },
  });
  await page.evaluate(() => (window as unknown as HarnessWindow).__attemptStatus.dispose());
  await expect.poll(async () => (await snapshot(page)).flowFrees).toBe(1);
});
