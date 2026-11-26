import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * @pubky/passport-auth, built from packages/passport-auth, on a client page against the real
 * /authorize. The SDK is a fixture (e2e/fixtures/passport-auth/fake-pubky.js): it creates real
 * grant requests and returns a Session only after Passport posted its approval to the relay.
 */

const APP_ORIGIN = "https://client.example";
const RELAY = "https://relay.client.example/inbox";
const FIXTURES = join(process.cwd(), "e2e", "fixtures", "passport-auth");
const DIST = join(process.cwd(), "packages", "passport-auth", "dist");
const SIGNER_PUBLIC_KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
const LOCAL_IDENTITY_STORAGE = {
  [`pubky-passport/local-identities/v1/identity/${SIGNER_PUBLIC_KEY}`]: JSON.stringify({
    v: 1,
    publicKeyZ32: SIGNER_PUBLIC_KEY,
    secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  }),
  "pubky-passport/local-identities/v1/active": SIGNER_PUBLIC_KEY,
};

type FixtureState = {
  starts: { xCallback?: Record<string, string> }[];
  results: { ok: boolean; reason?: string; publicKey?: string }[];
  polls: number;
  frees: number;
  violations: string[];
};

interface Harness {
  passportOrigin: string;
  /** Approvals Passport posted to the relay, over all flows. */
  relayApprovals: () => number;
  /** Bodies of those approvals. */
  relayBodies: Buffer[];
  /** URLs of callback pages served to the popup. */
  callbacks: string[];
  consoleText: string[];
}

async function setUp(page: Page, query: Record<string, string> = {}): Promise<Harness> {
  const context = page.context();
  const approvals = new Map<string, number>();
  const relayBodies: Buffer[] = [];
  const consoleText: string[] = [];
  context.on("console", (message) => consoleText.push(message.text()));
  await page.goto("/");
  const passportOrigin = new URL(page.url()).origin;
  await page.evaluate((entries) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
  }, Object.entries(LOCAL_IDENTITY_STORAGE));

  const callbacks: string[] = [];
  await routeClient(context, (flow) => approvals.get(flow) ?? 0, callbacks);
  await context.route(`${new URL(RELAY).origin}/**`, (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      // `${RELAY}/<flow id>/<channel>`: the fixture SDK gives every flow its own relay path.
      const flow = new URL(request.url()).pathname.split("/")[2] ?? "";
      approvals.set(flow, (approvals.get(flow) ?? 0) + 1);
      relayBodies.push(request.postDataBuffer() ?? Buffer.alloc(0));
    }
    return route.fulfill({
      status: 200,
      body: "",
      headers: {
        "access-control-allow-origin": passportOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  });
  // Keep background homeserver discovery off the network.
  await context.route("https://pkarr.*/**", (route) => route.fulfill({ status: 404 }));

  const search = new URLSearchParams({ instance: passportOrigin, relay: RELAY, ...query });
  await page.goto(`${APP_ORIGIN}/app?${search}`);
  await expect(page.locator("#sign-in")).toBeVisible();
  const relayApprovals = () => [...approvals.values()].reduce((sum, count) => sum + count, 0);
  return { passportOrigin, relayApprovals, relayBodies, callbacks, consoleText };
}

async function routeClient(
  context: BrowserContext,
  approvals: (flow: string) => number,
  callbacks: string[],
): Promise<void> {
  await context.route(`${APP_ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/__fixture/relay-approvals") {
      const flow = new URL(route.request().url()).searchParams.get("flow") ?? "";
      return route.fulfill({ json: { approvals: approvals(flow) } });
    }
    if (pathname === "/app") return route.fulfill({ path: join(FIXTURES, "app.html") });
    if (pathname === "/passport/return") {
      callbacks.push(route.request().url());
      return route.fulfill({ path: join(FIXTURES, "return.html") });
    }
    if (pathname === "/fake-pubky.js")
      return route.fulfill({
        body: await readFile(join(FIXTURES, "fake-pubky.js"), "utf8"),
        contentType: "text/javascript",
      });
    const file = /^\/pkg\/([a-z]+\.js)$/u.exec(pathname)?.[1];
    if (file)
      return route.fulfill({
        body: await readFile(join(DIST, file), "utf8"),
        contentType: "text/javascript",
      });
    return route.fulfill({ status: 404 });
  });
}

async function signIn(page: Page) {
  const popup = page.waitForEvent("popup");
  await page.locator("#sign-in").click();
  return popup;
}

function fixtureState(page: Page): Promise<FixtureState> {
  return page.evaluate(
    () => (window as unknown as { __passportAuthFixture: FixtureState }).__passportAuthFixture,
  );
}

async function resultOf(page: Page) {
  await expect.poll(async () => (await fixtureState(page)).results.length).toBe(1);
  const state = await fixtureState(page);
  expect(state.violations).toEqual([]);
  return state.results[0];
}

async function expectFreedOnce(page: Page) {
  await expect.poll(async () => (await fixtureState(page)).frees).toBe(1);
  // Give a poll that was in flight at the end time to return, then check it neither ran after
  // the free nor was freed under.
  await page.waitForTimeout(300);
  const state = await fixtureState(page);
  expect(state.frees).toBe(1);
  expect(state.violations).toEqual([]);
}

test("approving in Passport returns the Session from the relay and closes the popup", async ({
  page,
}) => {
  const harness = await setUp(page);
  const popup = await signIn(page);
  await expect(popup).toHaveURL(new RegExp(`^${harness.passportOrigin}/authorize`, "u"));
  await expect(popup.getByRole("heading", { name: "Sign in to Example App" })).toBeVisible();
  await expect(page.locator("#state")).toHaveText("pending");

  await popup.getByRole("button", { name: "Authorize", exact: true }).click();

  expect(await resultOf(page)).toEqual({ ok: true, publicKey: SIGNER_PUBLIC_KEY });
  expect(harness.relayApprovals()).toBe(1);
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.locator("#state")).toHaveText("idle");
  await expectFreedOnce(page);
  // The authorization URL carries the relay secret: it must never reach the console.
  expect(harness.consoleText.join("\n")).not.toContain("secret=");
});

test("cancelling in Passport ends the attempt as cancelled", async ({ page }) => {
  const harness = await setUp(page);
  const popup = await signIn(page);

  await popup.getByRole("button", { name: "Cancel" }).click();

  expect(await resultOf(page)).toEqual({ ok: false, reason: "cancelled" });
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(harness.relayApprovals()).toBe(0);
  await expectFreedOnce(page);
});

test("closing the popup ends the attempt as popup-closed", async ({ page }) => {
  await setUp(page);
  const popup = await signIn(page);
  await expect(popup.getByRole("button", { name: "Cancel" })).toBeVisible();

  await popup.close();

  expect(await resultOf(page)).toEqual({ ok: false, reason: "popup-closed" });
  await expectFreedOnce(page);
});

test("a blocked popup returns popup-blocked and starts nothing", async ({ page }) => {
  await setUp(page);
  await page.evaluate(() => {
    window.open = () => null;
  });
  let popups = 0;
  page.on("popup", () => (popups += 1));

  await page.locator("#sign-in").click();

  expect(await resultOf(page)).toEqual({ ok: false, reason: "popup-blocked" });
  const state = await fixtureState(page);
  expect(state.starts).toEqual([]);
  expect(popups).toBe(0);
  await expect(page.locator("#state")).toHaveText("idle");
});

test("when the outcome message is lost, the callback page reports it and closes the popup", async ({
  page,
}) => {
  // Drop Passport's outcome message before the package sees it: Passport gets no acknowledgement
  // and navigates the popup to the callback page after three seconds.
  await page.context().addInitScript((appOrigin) => {
    if (window.location.origin !== appOrigin) return;
    window.addEventListener(
      "message",
      (event) => {
        const data = event.data as { type?: unknown } | null;
        if (data?.type === "pubky-passport.authorization-outcome") event.stopImmediatePropagation();
      },
      true,
    );
  }, APP_ORIGIN);
  const harness = await setUp(page);
  const popup = await signIn(page);

  await popup.getByRole("button", { name: "Cancel", exact: true }).click();

  expect(await resultOf(page)).toEqual({ ok: false, reason: "cancelled" });
  expect(harness.callbacks).toHaveLength(1);
  expect(new URL(harness.callbacks[0]!).searchParams.get("passport-outcome")).toBe("cancel");
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(harness.relayApprovals()).toBe(0);
  await expectFreedOnce(page);
});

test("outcome messages from another origin or window are ignored", async ({ page }) => {
  await setUp(page);
  await page.context().route("https://attacker.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>
        const forged = { type: "pubky-passport.authorization-outcome", version: 1, outcome: "cancel", messageId: "forged" };
        parent.postMessage(forged, "*");
        if (opener) opener.postMessage(forged, "*");
        document.title = "posted";
      </script>`,
    }),
  );
  const popup = await signIn(page);
  await expect(popup.getByRole("button", { name: "Cancel" })).toBeVisible();
  const attemptId = new URL(
    (await fixtureState(page)).starts[0]!.xCallback!.xCancel!,
  ).searchParams.get("passport-attempt");

  // A foreign frame and a foreign window send Passport's message; the page itself sends the
  // callback message with the current attempt id, but not from the popup.
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "https://attacker.example/frame";
    document.body.append(frame);
  });
  await expect(page.frameLocator("iframe").locator("script")).toHaveCount(1);
  const foreign = page.waitForEvent("popup");
  await page.evaluate(() => window.open("https://attacker.example/window", "attacker"));
  const attacker = await foreign;
  await expect(attacker).toHaveTitle("posted");
  await page.evaluate(
    (id) =>
      window.postMessage(
        { type: "pubky-passport-auth.return", version: 1, attemptId: id, outcome: "cancel" },
        window.location.origin,
      ),
    attemptId,
  );
  await page.waitForTimeout(1_500);

  expect((await fixtureState(page)).results).toEqual([]);
  await expect(page.locator("#state")).toHaveText("pending");
  expect(popup.isClosed()).toBe(false);

  // The real popup still ends it.
  await popup.getByRole("button", { name: "Cancel" }).click();
  expect(await resultOf(page)).toEqual({ ok: false, reason: "cancelled" });
});

test("without callbackUrl Passport shows its own result and the Session still arrives", async ({
  page,
}) => {
  const harness = await setUp(page, { "no-callback": "" });
  const popup = await signIn(page);
  expect((await fixtureState(page)).starts[0]!.xCallback).toEqual({ xSource: "Example App" });

  await popup.getByRole("button", { name: "Authorize", exact: true }).click();

  expect(await resultOf(page)).toEqual({ ok: true, publicKey: SIGNER_PUBLIC_KEY });
  expect(harness.relayApprovals()).toBe(1);
  // The package closes the popup Passport left open on its result screen.
  await expect.poll(() => popup.isClosed()).toBe(true);
});

test("the deadline ends a pending attempt and closes the popup", async ({ page }) => {
  await setUp(page, { timeout: "3000" });
  const popup = await signIn(page);
  await expect(popup.getByRole("button", { name: "Cancel" })).toBeVisible();

  expect(await resultOf(page)).toEqual({ ok: false, reason: "timeout" });
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expectFreedOnce(page);
});

test("an e capability sends a signed approval through the real /authorize", async ({ page }) => {
  const harness = await setUp(page, { caps: "/pub/example.app/:rw,/priv/example.app/:e" });
  const popup = await signIn(page);
  expect((await fixtureState(page)).starts[0]).toMatchObject({
    approvalFormat: "signedApprovalV1",
  });
  await expect(
    popup.getByRole("checkbox", { name: "Encrypt and decrypt content /priv/example.app/" }),
  ).toBeChecked();

  await popup.getByRole("button", { name: "Authorize", exact: true }).click();

  expect(await resultOf(page)).toEqual({ ok: true, publicKey: SIGNER_PUBLIC_KEY });
  expect(harness.relayBodies).toHaveLength(1);
  expect(harness.relayBodies[0]!.subarray(0, 14).toString()).toBe("pubky-hpke-v1\0");
  await expectFreedOnce(page);
});

test("a foreign page loaded in the popup cannot end or complete the attempt", async ({ page }) => {
  await setUp(page);
  await page.context().route("https://attacker.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>
        const outcome = { type: "pubky-passport.authorization-outcome", version: 1, outcome: "success", messageId: "forged" };
        if (opener) {
          opener.postMessage(outcome, "*");
          opener.postMessage({ ...outcome, outcome: "cancel" }, "*");
          opener.postMessage({ type: "pubky-passport-auth.return", version: 1, attemptId: window.name, outcome: "cancel" }, "*");
        }
        document.title = opener ? "posted" : "no opener";
      </script>`,
    }),
  );
  const popup = await signIn(page);
  await expect(popup.getByRole("button", { name: "Cancel" })).toBeVisible();

  // The attempt's own popup window now shows an attacker page: right source, wrong origin.
  // Browsers that keep Passport's COOP boundary give that page no opener at all.
  await popup.goto("https://attacker.example/in-popup");
  await expect(popup).toHaveTitle(/^(posted|no opener)$/u);
  await page.waitForTimeout(1_500);
  const early = (await fixtureState(page)).results;
  expect(early.every((result) => result.reason === "popup-closed")).toBe(true);

  if (!popup.isClosed()) await popup.close();
  expect(await resultOf(page)).toEqual({ ok: false, reason: "popup-closed" });
  await expectFreedOnce(page);
});
