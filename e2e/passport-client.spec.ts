import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { E2E_HTTP_RELAY_URL } from "./helpers/e2eServer";
import { PKARR_RELAY_HOSTS } from "./helpers/network";
import { emulateCoarsePointerInContext } from "./helpers/pointer";
import { ringApproves, type RingNetwork } from "./helpers/pubkyRing";
import type { Route } from "@playwright/test";
import { expect, test, type Page } from "./helpers/passportTest";
import {
  homeserverRecord,
  HOMESERVER,
  PROFILE_KEY,
  seedProfileIdentity,
} from "./helpers/pubkyProfile";

const CLIENT = "https://client.example";
// A long port-forwarding origin, the shape a development host often has.
const DEMO = "https://5173--main--workspace--developer.coder.example";
const CAPABILITIES = "/pub/example.app/:rw";
const SECRET = ["kqnceEMgrNQM_xi06oQXjA3c", "JHX_RQmw1BY6JE1bse8"].join("");
// The package's flows carry no callbacks; the fake SDK hands this URL to the popup.
const REQUEST = `pubkyauth://signin?caps=${CAPABILITIES}&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=ClientFixture`;

type Facade = {
  configure(options: object): void;
  state(): { status: string; handshake?: string; error?: { code: string } };
  states: string[];
  publicKeys: string[];
  profiles: unknown[];
  diagnostics: { code: string }[];
  reset(): void;
};
type FakeSdk = {
  approve(): void;
  starts: { callbacks: boolean }[];
  profileReads: string[];
  signouts: number;
};
type FixtureWindow = Window & { __facade: Facade; __fakeSdk: FakeSdk };

type Homeserver = (route: Route) => Promise<void>;
type ClientOptions = {
  client?: string;
  profile?: "required" | "optional";
  variant?: "large";
  /** Internal client timeouts, to reach a timer's end in a test. */
  timeouts?: Record<string, number>;
  /** Gives each fake SDK flow its own link. */
  numberLinks?: boolean;
  homeserver?: Homeserver;
  /** Passport's own relay, for its Ring profile grant. */
  relay?: (route: Route) => Promise<void>;
};

/** Serves the built package, the fake SDK and the fixture page at https://client.example. */
async function openClient(
  page: Page,
  baseURL: string,
  {
    client = CLIENT,
    profile = "optional",
    variant,
    timeouts,
    numberLinks,
    homeserver,
    relay,
  }: ClientOptions = {},
) {
  const passportOrigin = new URL(baseURL).origin;
  const directory = "packages/passport-client/dist";
  const files = new Map([
    ["/", "e2e/fixtures/passport-client/facade.html"],
    ["/facade.js", "e2e/fixtures/passport-client/facade.js"],
    ["/fake-sdk.js", "e2e/fixtures/passport-client/fake-sdk.js"],
    ["/pubky-app-specs.js", "node_modules/pubky-app-specs/index.js"],
  ]);
  for (const path of await readdir(directory, { recursive: true }))
    if (path.endsWith(".js")) files.set(`/modules/${path}`, join(directory, path));
  const relayPosts: string[] = [];
  const context = page.context();
  await context.route(/https?:\/\//u, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === passportOrigin) return route.fallback();
    if (PKARR_RELAY_HOSTS.has(url.hostname)) {
      if (route.request().method() === "PUT") return route.fulfill({ status: 200, body: "" });
      const body = homeserverRecord(url.pathname.slice(1));
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    }
    // The identity's homeserver: by default a published profile and nothing else.
    if (url.hostname === "homeserver.example")
      return homeserver
        ? homeserver(route)
        : url.pathname.endsWith("/pub/pubky.app/profile.json") && route.request().method() === "GET"
          ? route.fulfill({ json: { name: "Fixture Person", extra: "dropped" } })
          : route.fulfill({ status: 404, body: "" });
    if (relay && url.hostname === new URL(E2E_HTTP_RELAY_URL).hostname) return relay(route);
    if (url.origin === "https://relay.client.example") {
      if (route.request().method() === "POST") {
        relayPosts.push(url.pathname);
        // Passport delivered the approval to the app's relay; the app's SDK now gets its Session.
        await page.evaluate(() => (window as unknown as FixtureWindow).__fakeSdk.approve());
      }
      return route.fulfill({ status: 200, body: "" });
    }
    const file = url.origin === client ? files.get(url.pathname) : undefined;
    if (!file) return route.abort();
    return route.fulfill({
      contentType: file.endsWith(".js") ? "text/javascript" : "text/html",
      body: await readFile(file, "utf8"),
    });
  });
  await page.goto(`${client}/`);
  await page.waitForFunction(() => "__facade" in window);
  await page.evaluate(
    (options) => (window as unknown as FixtureWindow).__facade.configure(options),
    {
      instance: passportOrigin,
      authorizationUrl: REQUEST,
      publicKey: PROFILE_KEY,
      capabilities: CAPABILITIES,
      profile,
      variant,
      timeouts,
      numberLinks,
    },
  );
  return { relayPosts };
}

/** `text` as a literal inside a regular expression. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const facade = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as FixtureWindow).__facade;
    const state = h.state();
    return {
      // Errors lose their own fields when they cross into the test process.
      state: { ...state, ...(state.error ? { error: { code: state.error.code } } : {}) },
      states: h.states,
      publicKeys: h.publicKeys,
      profiles: h.profiles,
      diagnostics: h.diagnostics.map((value) => value.code),
    };
  });

async function openPopup(page: Page) {
  const button = page.locator("pubky-passport").locator('[part="button"]');
  await expect(button).toHaveText("Continue with Pubky");
  const popup = page.waitForEvent("popup");
  await button.click();
  return popup;
}

for (const client of [CLIENT, DEMO]) {
  const host = new URL(client).host;
  test(`the element signs in from ${host} through a v2 popup named by its opener`, async ({
    page,
    baseURL,
  }) => {
    await seedProfileIdentity(page, false);
    const { relayPosts } = await openClient(page, baseURL!, { client });
    const popup = await openPopup(page);
    await expect(popup).toHaveURL(new URL("/authorize", baseURL!).href);
    // The hello carried this request's digest, so Passport bound it to its opener (A39/A40).
    await expect
      .poll(async () => (await facade(page)).state)
      .toMatchObject({ status: "waiting", handshake: "confirmed" });
    await expect(popup.getByRole("complementary", { name: `Signing in to ${host}` })).toBeVisible();
    // One saved identity: the review opens directly, with no "names no website" line.
    await expect(popup.getByRole("heading", { name: "Signing in to ClientFixture" })).toBeVisible();
    await expect(popup.getByRole("complementary", { name: `Signing in to ${host}` })).toBeVisible();
    // The package's requests carry no callbacks; the bound opener names the website instead.
    await expect(popup.getByText(/doesn.t name a website/u)).toHaveCount(0);
    await expect(popup.getByText(/verified/iu)).toHaveCount(0);
    await popup.getByRole("button", { name: "Authorize", exact: true }).click();

    await expect.poll(async () => (await facade(page)).state.status).toBe("signed-in");
    expect(relayPosts).toHaveLength(1);
    await expect.poll(() => popup.isClosed()).toBe(true);
    expect((await facade(page)).publicKeys).toEqual([PROFILE_KEY]);
    // The package read the profile once and returned it validated and sanitised.
    expect((await facade(page)).profiles).toEqual([{ name: "Fixture Person" }]);
    expect(
      await page.evaluate(() => (window as unknown as FixtureWindow).__fakeSdk.profileReads.length),
    ).toBe(1);
    await expect(page.locator("#who")).toHaveText(`pubky${PROFILE_KEY}`);
    // Signed in, the element renders nothing; the app shows its own signed-in UI.
    await expect(page.locator("pubky-passport").locator('[part="button"]')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as FixtureWindow).__fakeSdk.starts),
    ).toEqual([
      {
        capabilities: CAPABILITIES,
        clientId: "client.example",
        xSource: "ClientFixture",
        callbacks: false,
      },
    ]);
    const markup = await page.evaluate(() => document.documentElement.outerHTML);
    expect(markup).not.toContain(SECRET);

    await page.evaluate(() => (window as unknown as FixtureWindow).__facade.reset());
    await expect(page.locator("pubky-passport").locator('[part="button"]')).toHaveText(
      "Continue with Pubky",
    );
  });
}

test("the app's popup stays bound to its request when a blocked Google window sends the sign-in through the same window", async ({
  page,
  baseURL,
}) => {
  await openClient(page, baseURL!, { profile: "required" });
  // Google's side, in the same window (registered after the fixture's routes, so it wins).
  const context = page.context();
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", (route) => {
    const request = new URL(route.request().url());
    const claims = Buffer.from(
      JSON.stringify({ sub: "google-user", nonce: request.searchParams.get("nonce") }),
    ).toString("base64url");
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    callback.hash = new URLSearchParams({
      access_token: "access-token",
      id_token: `header.${claims}.signature`,
      state: request.searchParams.get("state")!,
      scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
      expires_in: "3600",
    }).toString();
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>location.replace(${JSON.stringify(callback.href)})</script>`,
    });
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
    route.fulfill({ json: { sub: "google-user", email: "test@example.com", name: "Test" } }),
  );
  await context.route("https://www.googleapis.com/drive/v3/files**", (route) =>
    route.fulfill({ json: { files: [] } }),
  );

  const popup = await openPopup(page);
  const band = popup.getByRole("complementary", { name: "Signing in to client.example" });
  // Nothing is saved in Passport: the request opens on its start page, bound to its opener.
  await expect(band).toBeVisible();
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", handshake: "confirmed" });
  // The browser refuses Passport's window a window of its own, so Google comes to this one.
  await popup.evaluate(() => {
    window.open = () => null;
  });
  await popup
    .getByRole("region", { name: "Create account" })
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();

  // Back from Google, on the origin root: the sign-in stops to ask about the folder copy. The
  // app keeps asking after its request every two seconds, and the page answers for it, so the
  // band still names the app and the attempt is not reported lost.
  await expect(popup.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  await expect(popup).toHaveURL(new URL("/", baseURL!).href);
  await expect(band).toBeVisible();
  // Longer than the app's heartbeat, so its hello reached the callback page at least once.
  await popup.waitForTimeout(2_500);
  expect((await facade(page)).state).toMatchObject({ status: "waiting", handshake: "confirmed" });
  expect((await facade(page)).diagnostics).not.toContain("request_lost");
  expect(popup.isClosed()).toBe(false);

  // Back returns to the request's own page, which binds to the same app again.
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect(popup.getByRole("region", { name: "Create account" })).toBeVisible();
  await expect(popup).toHaveURL(new URL("/authorize", baseURL!).href);
  await expect(band).toBeVisible();
  await expect(popup.getByText(/doesn.t name a website/u)).toHaveCount(0);
  expect((await facade(page)).state).toMatchObject({ status: "waiting", handshake: "confirmed" });
});

test("cancelling in Passport ends the attempt as cancelled and closes the popup", async ({
  page,
  baseURL,
}) => {
  await seedProfileIdentity(page, false);
  await openClient(page, baseURL!);
  const popup = await openPopup(page);
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", handshake: "confirmed" });
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "failed", error: { code: "cancelled" } });
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.locator("pubky-passport").getByRole("status")).toHaveText(
    "Sign-in was cancelled.",
  );
  expect((await facade(page)).publicKeys).toEqual([]);
});

test("the large element's Ring code copies its link, expires blurred and reloads a fresh request", async ({
  page,
  baseURL,
}) => {
  await openClient(page, baseURL!, {
    variant: "large",
    timeouts: { ringLinkRotateMs: 4000 },
    numberLinks: true,
  });
  const element = page.locator("pubky-passport");
  const qr = element.locator('[part="qr"]');
  await expect(qr).toHaveAttribute("data-state", "ready");
  // Passport's frame: 8px of light padding around the code, on a rounded-md tile.
  const frame = await qr.evaluate((node) => {
    const style = getComputedStyle(node);
    return { padding: style.padding, radius: style.borderRadius };
  });
  expect(frame).toEqual({ padding: "8px", radius: "8px" });
  const tile = (await qr.boundingBox())!;
  const code = (await qr.locator('[data-slot="qr-code"]').boundingBox())!;
  expect(code.x - tile.x).toBeCloseTo(8, 0);
  expect(tile.x + tile.width - (code.x + code.width)).toBeCloseTo(8, 0);
  expect(code.y - tile.y).toBeCloseTo(8, 0);

  // The press copies exactly the link the code encodes.
  await page.evaluate(() => {
    const copied: string[] = [];
    Object.assign(window, { __copied: copied });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
  });
  const copied = () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  await qr.getByRole("button", { name: "Copy authentication link" }).click();
  // Only screen readers hear the copy; nothing is added under the code.
  await expect(element.getByRole("status")).toHaveText("Link copied");
  await expect(element.locator('[data-slot="qr-note"]')).toHaveCount(0);
  expect(await copied()).toEqual([`${REQUEST}&flow=0`]);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(SECRET);

  // A hidden page cannot swap the code in place, so it expires: blurred, with a reload.
  await page.evaluate(() => {
    Object.assign(window, { __hidden: true });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => ((window as unknown as { __hidden: boolean }).__hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(qr).toHaveAttribute("data-state", "expired");
  await expect(qr.getByText("Click to reload")).toBeVisible();
  expect((await facade(page)).state).toMatchObject({ status: "ready", expired: true });
  await expect(qr.getByRole("button", { name: "Copy authentication link" })).toHaveCount(0);
  await qr.getByRole("button", { name: "Reload QR code" }).click();
  // Visible again (no event, so nothing else rotates now): a later rotation swaps in place.
  await page.evaluate(() => Object.assign(window, { __hidden: false }));

  // A fresh request without a page reload, and the press copies its link, not the expired one.
  await expect(qr).toHaveAttribute("data-state", "ready");
  await qr.getByRole("button", { name: "Copy authentication link" }).click();
  await expect.poll(async () => (await copied()).length).toBe(2);
  const [, fresh] = await copied();
  expect(fresh).toMatch(new RegExp(`^${escape(REQUEST)}&flow=[1-9]\\d*$`, "u"));
});

/**
 * The identity's homeserver for a profile publish: it signs the local key in, stores what is
 * written and serves `profile.json` back, which starts out missing.
 */
function writableHomeserver(written: Map<string, string>): Homeserver {
  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/auth/grant/session" && request.method() === "POST") {
      const { grant } = request.postDataJSON() as { grant: string };
      const claims = JSON.parse(
        Buffer.from(grant.split(".")[1]!, "base64url").toString("utf8"),
      ) as { iss: string; client_id: string; caps: string[]; jti: string; exp: number };
      const now = Math.floor(Date.now() / 1000);
      return route.fulfill({
        json: {
          token: "e2e-bearer",
          session: {
            homeserver: HOMESERVER,
            pubky: claims.iss,
            client_id: claims.client_id,
            capabilities: claims.caps,
            grant_id: claims.jti,
            token_expires_at: now + 3_600,
            grant_expires_at: claims.exp,
            created_at: now,
          },
        },
      });
    }
    const path = url.pathname.replace(/^\/storage\/[^/]+/u, "");
    if (request.method() === "PUT") {
      written.set(path, request.postData() ?? "");
      return route.fulfill({ status: 200, body: "" });
    }
    const stored = written.get(path);
    if (request.method() === "GET" && stored !== undefined)
      return route.fulfill({ status: 200, body: stored, contentType: "application/json" });
    return route.fulfill({ status: request.method() === "GET" ? 404 : 200, body: "" });
  };
}

test("an app that requires a profile gets one created in Passport before the review", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await seedProfileIdentity(page, false);
  const written = new Map<string, string>();
  await openClient(page, baseURL!, {
    profile: "required",
    homeserver: writableHomeserver(written),
  });
  const popup = await openPopup(page);
  // The hello bound to this request carries the requirement.
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", handshake: "confirmed" });
  // One saved identity, without a profile: the editor opens inside the sign-in, with no skipping.
  await expect(popup.getByRole("heading", { name: "Create your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(popup.getByText(/needs a public profile/u)).toBeVisible();
  await expect(popup.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
  await popup.getByLabel("Name", { exact: true }).fill("Fixture Person");
  await popup.getByRole("button", { name: "Save profile", exact: true }).click();

  // Published, the sign-in goes on to the app's review in the same window.
  await expect(popup.getByRole("heading", { name: "Signing in to ClientFixture" })).toBeVisible({
    timeout: 20_000,
  });
  const profile = [...written].find(([path]) => path.endsWith("/pub/pubky.app/profile.json"));
  expect(JSON.parse(profile![1])).toMatchObject({ name: "Fixture Person" });
  await popup.getByRole("button", { name: "Authorize", exact: true }).click();
  await expect.poll(async () => (await facade(page)).state.status).toBe("signed-in");
  expect((await facade(page)).profiles).toMatchObject([{ name: "Fixture Person" }]);
});

test("Passport honours profile=required next to d=, the same-tab form of the requirement", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await seedProfileIdentity(page, false);
  const written = new Map<string, string>();
  const homeserver = writableHomeserver(written);
  await page.context().route(/^https:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/u, async (route) => {
    const url = new URL(route.request().url());
    if (PKARR_RELAY_HOSTS.has(url.hostname)) {
      if (route.request().method() === "PUT") return route.fulfill({ status: 200, body: "" });
      const body = homeserverRecord(url.pathname.slice(1));
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    }
    if (url.hostname === "homeserver.example") return homeserver(route);
    return route.abort();
  });
  // What the package's same-tab fallback navigates to.
  await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}&profile=required`);
  // One saved identity: the request opens on it, and it has no profile.
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await page.getByLabel("Name", { exact: true }).fill("Same Tab");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Signing in to ClientFixture" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  // The address bar lost the request and its requirement.
  expect(new URL(page.url()).hash).toBe("");
});

/** Passport's relay for its Ring profile grant, answered the way `mockRingNetwork` answers it. */
function ringRelay(): { net: RingNetwork; relay: (route: Route) => Promise<void> } {
  const net: RingNetwork = {
    inbox: new Map(),
    waiting: [],
    exchangedGrants: [],
    writes: [],
    relayRequests: [],
  };
  const relay = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const channel = `${url.hostname}${url.pathname}`;
    net.relayRequests.push(`${request.method()} ${url.pathname}`);
    if (request.method() === "DELETE") net.inbox.delete(channel);
    if (request.method() !== "GET") return route.fulfill({ status: 200, body: "" });
    const message = net.inbox.get(channel);
    if (message)
      return route.fulfill({ status: 200, body: message, contentType: "application/octet-stream" });
    net.waiting.push({ channel, route }); // A long poll, answered once Ring approves.
  };
  return { net, relay };
}

/** Ring approves Passport's own write-only profile grant, as its "Open Pubky Ring" link asks. */
async function ringApprovesProfileGrant(popup: Page, net: RingNetwork): Promise<void> {
  const link = popup
    .getByRole("region", { name: "Pubky Ring profile connection" })
    .locator('a[href^="pubkyauth:"]');
  await expect(link).toHaveAttribute("href", /^pubkyauth:\/\//u, { timeout: 20_000 });
  await ringApproves(net, (await link.getAttribute("href"))!);
}

/**
 * The app's sign-in through Pubky Ring: Passport hands the request to Ring, Ring (the fake SDK)
 * answers the app, and the app, finding no profile for the required sign-in, asks Passport.
 */
async function signInThroughRing(page: Page, baseURL: string) {
  const written = new Map<string, string>();
  const { net, relay } = ringRelay();
  // Passport's windows behave as on a phone, where Ring hand-offs show their link (the test
  // approves through it); the app page itself is already open and keeps a computer's pointer.
  await emulateCoarsePointerInContext(page.context());
  await openClient(page, baseURL, {
    profile: "required",
    homeserver: writableHomeserver(written),
    relay,
  });
  const popup = await openPopup(page);
  // Nothing saved in Passport: the request's start page offers Pubky Ring.
  await popup.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", phase: "ring" });
  // Ring approved: the app's SDK gets its Session, holds it, and asks for the profile.
  await page.evaluate(() => (window as unknown as FixtureWindow).__fakeSdk.approve());
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "needs-profile", passport: "open" });
  expect((await facade(page)).publicKeys).toEqual([]);
  return { popup, net, written };
}

/**
 * Passport's Ring profile-grant screen as an app's sign-in reaches it: its own heading and a lead
 * naming `app`, instead of the plain "Connect Pubky Ring." of Passport's home.
 */
async function expectAppProfileGrantScreen(popup: Page, app: string): Promise<void> {
  await expect(popup.getByRole("heading", { name: "Set up your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(popup.getByRole("heading", { name: "Connect Pubky Ring." })).toHaveCount(0);
  await expect(
    popup.getByText(
      `You’re signed in with Pubky Ring, but ${app} needs a public profile. Approve in Pubky Ring so Passport can create it for you. Passport can only edit your profile and avatar; your private key stays in Pubky Ring.`,
    ),
  ).toBeVisible();
}

async function publishProfile(popup: Page, name: string): Promise<void> {
  await expect(popup.getByRole("heading", { name: "Create your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(popup.getByText(/needs a public profile/u)).toBeVisible();
  await expect(popup.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await popup.getByLabel("Name", { exact: true }).fill(name);
  await popup.getByRole("button", { name: "Save profile", exact: true }).click();
}

async function expectSignedInWithProfile(page: Page, name: string, written: Map<string, string>) {
  await expect
    .poll(async () => (await facade(page)).state.status, { timeout: 20_000 })
    .toBe("signed-in");
  expect((await facade(page)).publicKeys).toEqual([PROFILE_KEY]);
  // The profile as pubky-app-specs returns it (empty optional fields included).
  expect((await facade(page)).profiles).toMatchObject([{ name }]);
  const profile = [...written].find(([path]) => path.endsWith("/pub/pubky.app/profile.json"));
  expect(JSON.parse(profile![1])).toMatchObject({ name });
  await expect(page.locator("pubky-passport").locator('[part="button"]')).toHaveCount(0);
}

test("after a Pubky Ring sign-in, the missing profile is created inside Passport's window", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const { popup, net, written } = await signInThroughRing(page, baseURL!);
  // Passport connects its own write-only profile grant for that key first: no skip, no Back. The
  // person just approved the app in Ring, so the screen says they are signed in, that the app
  // (named as the band names it) needs a profile, and what approving once more does.
  await expectAppProfileGrantScreen(popup, "client.example");
  await expect(popup.getByRole("region", { name: "Pubky Ring profile connection" })).toBeVisible();
  await expect(popup.getByText(/Waiting for|Preparing your/u)).toHaveCount(0);
  await expect(popup.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await expect(popup.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await ringApprovesProfileGrant(popup, net);
  await publishProfile(popup, "Ring Person");
  // profile-ready: the app reads the profile, signs in, and closes the window (its done screen,
  // "Profile published.", shows only until then).
  await expectSignedInWithProfile(page, "Ring Person", written);
  await expect.poll(() => popup.isClosed()).toBe(true);
});

for (const closedDuring of ["the Ring grant", "the editor"] as const) {
  test(`Passport closed during ${closedDuring}: the button reopens the profile setup for that key`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const { popup, net, written } = await signInThroughRing(page, baseURL!);
    await expectAppProfileGrantScreen(popup, "client.example");
    if (closedDuring === "the editor") {
      await ringApprovesProfileGrant(popup, net);
      await expect(popup.getByRole("heading", { name: "Create your profile." })).toBeVisible({
        timeout: 20_000,
      });
    }
    await popup.close();
    // The Session stays held; the button says the profile is still needed.
    await expect
      .poll(async () => (await facade(page)).state, { timeout: 20_000 })
      .toMatchObject({ status: "needs-profile" });
    const button = page.locator("pubky-passport").locator('[part="button"]');
    await expect(button).toHaveText("Finish your profile");
    // Clicking reopens Passport straight on this key's profile setup, never the start page.
    const reopened = page.waitForEvent("popup");
    await button.click();
    const profilePage = await reopened;
    await expect(profilePage).toHaveURL(new URL("/", baseURL!).href);
    // Reopened without the request, nothing names the app: the same screen says "this app".
    await expectAppProfileGrantScreen(profilePage, "this app");
    await expect(profilePage.getByRole("heading", { name: "Get your pubky." })).toHaveCount(0);
    await ringApprovesProfileGrant(profilePage, net);
    await publishProfile(profilePage, "Ring Person");
    await expectSignedInWithProfile(page, "Ring Person", written);
    await expect.poll(() => profilePage.isClosed()).toBe(true);
  });
}

test("the profile can also be finished from Passport's home; the app picks it up on focus", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const { popup, net, written } = await signInThroughRing(page, baseURL!);
  await expectAppProfileGrantScreen(popup, "client.example");
  await popup.close();
  await expect
    .poll(async () => (await facade(page)).state, { timeout: 20_000 })
    .toMatchObject({ status: "needs-profile" });
  // Passport remembers the identity with its profile still to do, so home offers it.
  const home = await page.context().newPage();
  await home.goto(new URL("/", baseURL!).href);
  await expect(home.getByRole("heading", { name: "Your pubky." })).toBeVisible({ timeout: 20_000 });
  await home.getByRole("button", { name: "Set up profile" }).click();
  // Connected from Passport's own home, the screen keeps the connection's own copy.
  await expect(home.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(home.getByText(/You’re signed in with Pubky Ring/u)).toHaveCount(0);
  await expect(
    home.getByText(/Approve in Pubky Ring so Passport can edit your public profile and avatar/u),
  ).toBeVisible();
  await ringApprovesProfileGrant(home, net);
  await expect(home.getByRole("heading", { name: "Create your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await home.getByLabel("Name", { exact: true }).fill("Ring Person");
  await home.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(home.getByRole("heading", { name: "Your pubky." })).toBeVisible({ timeout: 20_000 });
  // Back in the app: its window regaining focus rereads the profile and finishes the sign-in.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectSignedInWithProfile(page, "Ring Person", written);
});

test("with profile optional, an identity without a profile signs in with profile null", async ({
  page,
  baseURL,
}) => {
  await seedProfileIdentity(page, false);
  await openClient(page, baseURL!, {
    profile: "optional",
    homeserver: (route) => route.fulfill({ status: 404, body: "" }),
  });
  const popup = await openPopup(page);
  await expect(popup.getByRole("heading", { name: "Signing in to ClientFixture" })).toBeVisible();
  await popup.getByRole("button", { name: "Authorize", exact: true }).click();
  await expect.poll(async () => (await facade(page)).state.status).toBe("signed-in");
  expect((await facade(page)).profiles).toEqual([null]);
});
