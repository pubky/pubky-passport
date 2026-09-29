import { E2E_HTTP_RELAY_URL } from "./helpers/e2eServer";
import { type BrowserContext, expect, test, type Page } from "./helpers/passportTest";
import { emulateCoarsePointer } from "./helpers/pointer";
import {
  delegatedKeyCount,
  mockRingNetwork,
  retryFlakyEd25519KeyGeneration,
  RING_KEY,
  ringApproves,
  seedRingIdentity,
} from "./helpers/pubkyRing";

// Pubky Ring is played by the real SDK signer in the test process; see `helpers/pubkyRing.ts`.
const PROFILE_CAPABILITIES = [
  "/pub/pubky.app/profile.json:w",
  "/pub/pubky.app/files/:w",
  "/pub/pubky.app/blobs/:w",
];
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const APP_REQUEST =
  `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}` +
  "&x-source=Client%20App&x-success=https%3A%2F%2Fclient.example%2Fsuccess" +
  "&x-error=https%3A%2F%2Fclient.example%2Ferror&x-cancel=https%3A%2F%2Fclient.example%2Fcancel";
const APP_REQUEST_WITHOUT_CALLBACKS = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client%20App`;

/**
 * The profile connection's request, read from its link. Only a phone gets the link (a computer
 * gets the QR code alone), so the specs reading it emulate a coarse pointer.
 */
async function profileConnectionRequest(page: Page): Promise<URL> {
  const link = page.getByRole("link", { name: "Connect in Pubky Ring" });
  await expect(link).toHaveAttribute("href", /^pubkyauth:\/\//u);
  return new URL((await link.getAttribute("href"))!);
}

test("adds an existing Ring identity from the home page with a write-only grant, leaving its profile", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  await emulateCoarsePointer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);

  const request = await profileConnectionRequest(page);
  expect(request.searchParams.get("caps")?.split(",")).toEqual(PROFILE_CAPABILITIES);
  expect(request.searchParams.get("relay")).toBe(E2E_HTTP_RELAY_URL);
  await expect.poll(() => net.relayRequests.length).toBeGreaterThan(0);
  await ringApproves(net, request.href);

  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByText("Carol", { exact: true })).toBeVisible();
  expect(net.exchangedGrants).toEqual([PROFILE_CAPABILITIES]);
  // An existing profile is not overwritten: nothing is written.
  expect(net.writes).toEqual([]);
  expect(
    await page.evaluate(
      (key) =>
        JSON.parse(localStorage.getItem(`pubky-passport/local-identities/v1/identity/${key}`)!),
      RING_KEY,
    ),
  ).toEqual({ v: 1, publicKeyZ32: RING_KEY, keySource: "ring" });
});

test("keeps profile edits across a Ring reconnect and publishes them only on Save", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, {
    profile: {
      name: "Carol",
      bio: "Keeps her keys on her phone.",
      links: [{ title: "Website", url: "https://carol.example/" }],
      image: null,
      status: null,
    },
  });
  await emulateCoarsePointer(page);
  await seedRingIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  // The shared Ring hand-off: what to do, Passport waiting, and where to get Pubky Ring.
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Waiting for approval" })).toHaveText(
    "Waiting for approval in Pubky Ring…",
  );
  await expect(
    page.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
  ).toBeVisible();
  await ringApproves(net, (await profileConnectionRequest(page)).href);

  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Carol");
  await name.fill("Carol Danvers");
  await page.getByLabel("Bio", { exact: true }).fill("Pilot. Keeps her keys on her phone.");
  // The homeserver refuses the grant's first write: the grant has ended.
  let refused = false;
  await page.route("https://homeserver.example/**", async (route) => {
    if (route.request().method() !== "PUT" || refused) return route.fallback();
    refused = true;
    return route.fulfill({ status: 403, body: "grant expired" });
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Your edits are kept.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reconnect Pubky Ring" }).click();
  // The edits wait for this connection, so leaving it asks first.
  await expect(
    page.getByText("Your unsaved profile changes are kept until you leave."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Discard your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible();
  await ringApproves(net, (await profileConnectionRequest(page)).href);

  await expect(name).toHaveValue("Carol Danvers");
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue(
    "Pilot. Keeps her keys on her phone.",
  );
  await expect(page.getByText("Pubky Ring is connected again.", { exact: false })).toBeVisible();
  expect(net.writes).toEqual([]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  expect(net.writes.some((write) => write.endsWith("/pub/pubky.app/profile.json"))).toBe(true);
});

/** WebKit can take several seconds to write the SDK's IndexedDB key; the other engines take well under one. */
const DELEGATED_KEY_TIMEOUT_MS = 20_000;

test("an abandoned Ring connection leaves no delegated key in the browser", async ({ page }) => {
  // Otherwise a WebKit key generation that fails leaves the key in memory, and none is counted.
  await retryFlakyEd25519KeyGeneration(page);
  await mockRingNetwork(page);
  await emulateCoarsePointer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
  await profileConnectionRequest(page);
  // The SDK keeps the pending request's non-extractable PoP key in IndexedDB.
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);

  // Each new request replaces the previous one's key instead of adding to it.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
    await profileConnectionRequest(page);
    await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(1);
    await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  await expect.poll(() => delegatedKeyCount(page), { timeout: DELEGATED_KEY_TIMEOUT_MS }).toBe(0);
});

test("says so when the homeserver refuses the grant after Ring approved", async ({ page }) => {
  const net = await mockRingNetwork(page, { grantStatus: 403 });
  await emulateCoarsePointer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Pubky Ring" }).click();
  await ringApproves(net, (await profileConnectionRequest(page)).href);

  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Pubky Ring approved, but your homeserver did not accept the connection.",
  );
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an unfinished Ring identity opens the app's request first, with one Ring action", async ({
  page,
  isMobile,
}) => {
  const net = await mockRingNetwork(page, { profile: null });
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  await seedRingIdentity(page, true);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST)}`);

  await expect(page.getByRole("heading", { name: "Sign in to Client App" })).toBeVisible();
  // Passport's own profile request never stands in front of the app's request.
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Pubky Ring profile connection QR code", includeHidden: true }),
  ).toHaveCount(0);
  // The list labels the identity whose key stays in Ring.
  await page.getByRole("button", { name: /Key in Pubky Ring/u }).click();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/You’ll pick which identity to use in Pubky Ring/u)).toBeVisible();

  await page.getByRole("button", { name: "Continue in Pubky Ring" }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  await expect(page.getByText(/approve the sign-in to Client App/u)).toBeVisible();
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
  if (isMobile)
    await expect(page.getByRole("link", { name: "Open Pubky Ring" })).toHaveAttribute(
      "href",
      APP_REQUEST,
    );
  expect(net.relayRequests).toEqual([]);

  // Passport cannot see Ring's approval; the validated x-success callback is a hint for the app.
  await page.getByRole("button", { name: "I approved in Pubky Ring" }).click();
  await expect(page).toHaveURL("https://client.example/success");
  expect(net.relayRequests).toEqual([]);
});

/**
 * The app's relay, an inbox answering `/ack` reads as http-relay does: `404` until Ring posts,
 * `false` while the answer waits for the app, `true` once the app took it. Records every request.
 */
async function fakeAppRelay(context: BrowserContext) {
  const relay = {
    answer: "none" as "none" | "posted" | "taken",
    requests: [] as { method: string; path: string; ack: string }[],
  };
  await context.route("https://relay.client.example/**", (route) => {
    const request = route.request();
    const ack = { none: "404", posted: "false", taken: "true" }[relay.answer];
    relay.requests.push({ method: request.method(), path: new URL(request.url()).pathname, ack });
    return ack === "404"
      ? route.fulfill({ status: 404, body: "Not found" })
      : route.fulfill({ status: 200, body: ack, contentType: "text/plain" });
  });
  return relay;
}

/** Every look was a read of the acknowledgement on the app's channel, never of the answer. */
function expectOnlyAckReads(relay: Awaited<ReturnType<typeof fakeAppRelay>>): void {
  const looks = new Set(relay.requests.map(({ method, path }) => `${method} ${path}`));
  expect(looks.size).toBe(1);
  expect([...looks][0]).toMatch(/^GET \/inbox\/[\w-]{43}\/ack$/u);
}

test("in the app's popup, goes back to the app by itself only once the app took Ring's answer", async ({
  context,
  page,
}) => {
  const relay = await fakeAppRelay(context);
  await page.goto("/");
  const passportOrigin = new URL(page.url()).origin;
  await context.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  // The app's page: it acknowledges Passport's outcome message, as the integration guide asks.
  await page.goto("https://client.example/integration");
  await page.evaluate((trustedOrigin) => {
    window.addEventListener("message", (event) => {
      const message = event.data as Record<string, unknown>;
      if (event.origin !== trustedOrigin || message.type !== "pubky-passport.authorization-outcome")
        return;
      (event.source as Window | null)?.postMessage(
        {
          type: "pubky-passport.authorization-outcome-ack",
          version: 1,
          messageId: message.messageId,
        },
        trustedOrigin,
      );
      Object.defineProperty(window, "__passportOutcome", { value: message.outcome });
    });
  }, passportOrigin);
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(
    (url) => {
      window.open(url, "pubky-passport", "popup,width=520,height=760");
    },
    `${passportOrigin}/authorize#d=${encodeURIComponent(APP_REQUEST)}`,
  );
  const popup = await popupPromise;
  await popup.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  await expect(popup.getByRole("status")).toContainText("Passport continues by itself");
  await expect.poll(() => relay.requests.length, { timeout: 10_000 }).toBeGreaterThan(0);

  // Ring answers; until the app takes the answer, Passport stays and claims nothing.
  relay.answer = "posted";
  await expect
    .poll(() => relay.requests.some(({ ack }) => ack === "false"), { timeout: 10_000 })
    .toBe(true);
  await expect(popup.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();

  relay.answer = "taken";
  await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true);
  expect(
    await page.evaluate(
      () => (window as Window & { __passportOutcome?: string }).__passportOutcome,
    ),
  ).toBe("success");
  expectOnlyAckReads(relay);
});

test("in the same tab, goes back to the app by itself once Ring's answer waits for it", async ({
  context,
  page,
}) => {
  const net = await mockRingNetwork(page);
  const relay = await fakeAppRelay(context);
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST)}`);
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  await expect.poll(() => relay.requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();

  // No SDK listens while Passport is shown: the app takes the answer once Passport navigates back.
  relay.answer = "posted";
  await expect(page).toHaveURL("https://client.example/success", { timeout: 10_000 });
  expectOnlyAckReads(relay);
  expect(net.relayRequests).toEqual([]);
});

test("without callbacks, says Ring's approval was sent once Passport saw it", async ({
  context,
  page,
}) => {
  await mockRingNetwork(page);
  const relay = await fakeAppRelay(context);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST_WITHOUT_CALLBACKS)}`);
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();

  relay.answer = "posted";
  await expect(page.getByRole("heading", { name: "Return to the app." })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByText("Pubky Ring sent its approval to the app. Return to it to finish signing in."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Signed in to/u })).toHaveCount(0);
  expectOnlyAckReads(relay);
});

test("without callbacks, the Ring screen sends the user back without claiming approval", async ({
  page,
}) => {
  await mockRingNetwork(page);
  await page.goto(`/authorize#d=${encodeURIComponent(APP_REQUEST_WITHOUT_CALLBACKS)}`);
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await page.getByRole("button", { name: "I approved in Pubky Ring" }).click();

  // Without callbacks the request names no website, so its own label names nothing here.
  await expect(page.getByRole("heading", { name: "Return to the app." })).toBeVisible();
  await expect(page.getByText(/Client App/u)).toHaveCount(0);
  await expect(page.getByText(/Passport cannot see the approval in Pubky Ring/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Signed in to/u })).toHaveCount(0);
});
