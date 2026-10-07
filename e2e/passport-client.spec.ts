import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { E2E_HTTP_RELAY_URL } from "./helpers/e2eServer";
import { PKARR_RELAY_HOSTS } from "./helpers/network";
import { emulateCoarsePointerInContext } from "./helpers/pointer";
import { newRingNetwork, ringApproves, type RingNetwork } from "./helpers/pubkyRing";
import type { Route } from "@playwright/test";
import { expect, test, type Page } from "./helpers/passportTest";
import {
  homeserverRecord,
  HOMESERVER,
  PROFILE_KEY,
  seedProfileIdentity,
} from "./helpers/pubkyProfile";
import { clientAuthRequest } from "./helpers/pubkyAuthRequests";
import { UNVERIFIED_HEADING, UNVERIFIED_WARNING } from "./helpers/requester";

const CLIENT = "https://client.example";
// A long port-forwarding origin, the shape a development host often has.
const FORWARDED = "https://5173--main--workspace--developer.coder.example";
const CAPABILITIES = "/pub/example.app/:rw";
const SECRET = ["kqnceEMgrNQM_xi06oQXjA3c", "JHX_RQmw1BY6JE1bse8"].join("");
/** The start page a request opens on when Passport has no identity to sign it with. */
const START_HEADING = { name: "Let’s join Pubky." } as const;
// The package's flows carry no callbacks; the fake SDK hands this URL to the popup.
const REQUEST = `pubkyauth://signin?caps=${CAPABILITIES}&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=ClientFixture`;
/** A grant request, the kind the package asks for by default, which either keychain app takes. */
const GRANT_REQUEST = clientAuthRequest({ capabilities: CAPABILITIES });

type Facade = {
  configure(options: object): void;
  state(): { status: string; handshake?: string; error?: { code: string } };
  states: string[];
  publicKeys: string[];
  profiles: unknown[];
  diagnostics: { code: string }[];
  reset(): void;
  headless(options: object): void;
  headlessClient: { describe(): { classicQr: boolean }; setClassicQr(on: boolean): void };
  headlessViews: boolean[];
};
type FakeSdk = {
  approve(): void;
  starts: { kind: "grant" | "cookie"; capabilities: string; callbacks: boolean }[];
  profileReads: string[];
  signouts: number;
};
type FixtureWindow = Window & { __facade: Facade; __fakeSdk: FakeSdk };

type Homeserver = (route: Route) => Promise<void>;
type ClientOptions = {
  client?: string;
  /** The link the fake SDK hands the package for each flow; `REQUEST` by default. */
  authorizationUrl?: string;
  profile?: "required" | "optional";
  variant?: "large";
  /** The Passport screen the element's sign-in opens on. */
  entry?: "join" | "google" | "sign-in";
  /** Internal client timeouts, to reach a timer's end in a test. */
  timeouts?: Record<string, number>;
  /** Gives each fake SDK flow its own link. */
  numberLinks?: boolean;
  homeserver?: Homeserver;
  /** Passport's own relay, for its Ring profile grant. */
  relay?: (route: Route) => Promise<void>;
  /** Mounts a hero, a header and a footer element in this `sync-group`. */
  syncGroup?: string;
};

/** Serves the built package, the fake SDK and the fixture page at https://client.example. */
async function openClient(
  page: Page,
  baseURL: string,
  {
    client = CLIENT,
    authorizationUrl = REQUEST,
    profile = "optional",
    variant,
    entry,
    timeouts,
    numberLinks,
    homeserver,
    relay,
    syncGroup,
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
  /** Loads the fixture page and mounts the app's markup, as the app's own page load would. */
  const load = async (navigate: () => Promise<unknown>) => {
    await navigate();
    await page.waitForFunction(() => "__facade" in window);
    await page.evaluate(
      (options) => (window as unknown as FixtureWindow).__facade.configure(options),
      {
        instance: passportOrigin,
        authorizationUrl,
        publicKey: PROFILE_KEY,
        capabilities: CAPABILITIES,
        profile,
        variant,
        entry,
        timeouts,
        numberLinks,
        syncGroup,
      },
    );
  };
  await load(() => page.goto(`${client}/`));
  return { relayPosts, reload: () => load(() => page.reload()) };
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

async function openPopup(page: Page, label = "Continue with Pubky") {
  const button = page.locator("pubky-passport").locator('[part="button"]');
  await expect(button).toHaveText(label);
  const popup = page.waitForEvent("popup");
  await button.click();
  return popup;
}

type Hello = { type: string; features: string[] };

/**
 * Records, in every Passport window the context opens from now on, each hello an app posts to it.
 * Returns what a given window received so far.
 */
async function recordHellos(page: Page, baseURL: string) {
  await page.context().addInitScript((origin) => {
    if (location.origin !== origin) return;
    const hellos: unknown[] = [];
    Object.defineProperty(window, "__hellos", { value: hellos });
    addEventListener("message", (event: MessageEvent<{ type?: unknown } | null>) => {
      if (event.data?.type === "pubky-passport.hello") hellos.push(event.data);
    });
  }, new URL(baseURL).origin);
  return (popup: Page) =>
    popup.evaluate(() => (window as Window & { __hellos?: Hello[] }).__hellos ?? []);
}

for (const client of [CLIENT, FORWARDED]) {
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
    await expect(popup.getByText(UNVERIFIED_WARNING)).toHaveCount(0);
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
        // The classic QR is off by default: a grant request, which either keychain app approves.
        kind: "grant",
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

for (const [entry, label, heading] of [
  ["join", "Join Pubky", "Let’s join Pubky."],
  ["google", "Continue with Google", "Continue with Google."],
] as const) {
  test(`an element with entry="${entry}" reads "${label}" and opens Passport on ${heading}`, async ({
    page,
    baseURL,
  }) => {
    const passport = new URL(baseURL!).origin;
    // The address Passport's window was opened at, before Passport takes the request out of it.
    await page.context().addInitScript((origin) => {
      if (location.origin === origin)
        Object.defineProperty(window, "__openedAt", { value: location.href });
    }, passport);
    await openClient(page, baseURL!, { entry });
    const popup = await openPopup(page, label);
    // Nothing is saved in Passport: the app's button picked the first screen, next to its request.
    await expect(popup.getByRole("heading", { name: heading })).toBeVisible();
    expect(
      await popup.evaluate(() => (window as Window & { __openedAt?: string }).__openedAt),
    ).toMatch(new RegExp(`^${escape(passport)}/authorize#d=[^&]+&entry=${entry}$`, "u"));
    expect(new URL(popup.url()).hash).toBe("");
    // The screen changes nothing else: the request is bound to its opener, as any other.
    await expect
      .poll(async () => (await facade(page)).state)
      .toMatchObject({ status: "waiting", handshake: "confirmed" });
    await expect(
      popup.getByRole("complementary", { name: "Signing in to client.example" }),
    ).toBeVisible();
  });
}

test("the large element's hello says it offers the keychain itself, so Passport's Join leaves its keychain line out", async ({
  page,
  baseURL,
}) => {
  const hellos = await recordHellos(page, baseURL!);
  await openClient(page, baseURL!, { variant: "large", authorizationUrl: GRANT_REQUEST });
  // The element holds a prepared keychain request: its code, beside the button.
  await expect(page.locator("pubky-passport").locator('[part="qr"]')).toHaveAttribute(
    "data-state",
    "ready",
  );
  const popup = await openPopup(page);
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", handshake: "confirmed" });
  // Every hello says so while the element offers its code.
  await expect.poll(async () => (await hellos(popup)).length).toBeGreaterThan(0);
  for (const hello of await hellos(popup))
    expect(hello.features).toEqual(["outcome-v2", "status", "keychain"]);

  // Nothing saved in Passport: Join, bound to the app, with the recovery file under its cards
  // and no way to the keychain, which the app's own code already is.
  await expect(popup.getByRole("heading", START_HEADING)).toBeVisible();
  await expect(
    popup.getByRole("complementary", { name: "Signing in to client.example" }),
  ).toBeVisible();
  await expect(popup.getByRole("button", { name: "Import it", exact: true })).toBeVisible();
  await expect(popup.getByRole("button", { name: /^Use Pubky Ring/u })).toHaveCount(0);
  await expect(popup.getByText(/Pubky Ring|Bitkit|keychain/u)).toHaveCount(0);
});

test("the small element's hello offers no keychain of its own, so Passport's Join hands the request to the keychain", async ({
  page,
  baseURL,
}) => {
  const hellos = await recordHellos(page, baseURL!);
  await openClient(page, baseURL!, { authorizationUrl: GRANT_REQUEST });
  // The small element prepares no keychain request: no code, nothing to open the app with.
  await expect(page.locator("pubky-passport").locator('[part="qr"]')).toHaveCount(0);
  const popup = await openPopup(page);
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", handshake: "confirmed" });
  await expect.poll(async () => (await hellos(popup)).length).toBeGreaterThan(0);
  for (const hello of await hellos(popup)) expect(hello.features).toEqual(["outcome-v2", "status"]);

  // Join, bound to the app: under its cards the recovery file, then the keychain (a grant
  // request, which either keychain app takes), then the consent line.
  await expect(popup.getByRole("heading", START_HEADING)).toBeVisible();
  await expect(
    popup.getByRole("complementary", { name: "Signing in to client.example" }),
  ).toBeVisible();
  const importIt = popup.getByRole("button", { name: "Import it", exact: true });
  const keychain = popup.getByRole("button", { name: "Use Pubky Ring or Bitkit", exact: true });
  await expect(keychain).toBeVisible();
  const consent = popup.getByRole("main").getByText(/^By joining and creating a Pubky account/u);
  const [importBox, keychainBox, consentBox] = await Promise.all(
    [importIt, keychain, consent].map(async (locator) => (await locator.boundingBox())!),
  );
  expect(keychainBox!.y + keychainBox!.height / 2).toBeGreaterThan(
    importBox!.y + importBox!.height,
  );
  expect(consentBox!.y).toBeGreaterThan(keychainBox!.y + keychainBox!.height / 2);

  // It hands the app's request over as it is, and the app hears the approval moved there.
  await keychain.click();
  await expect(popup.getByRole("heading", { name: "Sign in with keychain." })).toBeVisible();
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", phase: "ring" });
});

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
  await expect(popup.getByRole("heading", START_HEADING)).toBeVisible();
  await popup
    .getByRole("region", { name: "Quick & Easy" })
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
  await expect(popup.getByRole("heading", START_HEADING)).toBeVisible();
  await expect(popup).toHaveURL(new URL("/authorize", baseURL!).href);
  await expect(band).toBeVisible();
  await expect(popup.getByText(UNVERIFIED_WARNING)).toHaveCount(0);
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

test("Back on Join, the request's first screen, answers the app and closes the popup at once", async ({
  page,
  baseURL,
}) => {
  // Nothing saved in Passport: the popup opens on Join, whose Back answers the app.
  await openClient(page, baseURL!);
  const popup = await openPopup(page);
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", handshake: "confirmed" });
  await expect(popup.getByRole("heading", START_HEADING)).toBeVisible();
  const closed = popup.waitForEvent("close", { timeout: 5_000 });
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "failed", error: { code: "cancelled" } });
  await closed;
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

test("the large element's classic QR switch turns the next request into the legacy kind, kept for this device", async ({
  page,
  baseURL,
}) => {
  const { reload } = await openClient(page, baseURL!, { variant: "large" });
  const element = page.locator("pubky-passport");
  const qr = element.locator('[part="qr"]');
  const classic = element.getByRole("switch", {
    name: "Older Pubky Ring? Classic QR",
  });
  const divider = element.locator('[data-slot="divider"]');
  const starts = () =>
    page.evaluate(() => (window as unknown as FixtureWindow).__fakeSdk.starts.map((s) => s.kind));
  const stored = () =>
    page.evaluate(() => localStorage.getItem("pubky-passport-client/keychain-auth/v1"));

  // Off by default: the code is a grant request, which Pubky Ring 2.0 and Bitkit both approve.
  await expect(qr).toHaveAttribute("data-state", "ready");
  await expect(classic).not.toBeChecked();
  await expect(divider).toHaveText("or scan with Pubky Ring or Bitkit");
  expect(await starts()).toEqual(["grant"]);
  expect(await stored()).toBeNull();

  // On: the prepared code is replaced by a legacy cookie request, for Pubky Ring older than 2.0.
  await classic.click();
  await expect(classic).toBeChecked();
  await expect.poll(starts).toEqual(["grant", "cookie"]);
  expect(
    (await page.evaluate(() => (window as unknown as FixtureWindow).__fakeSdk.starts)).at(-1),
  ).toMatchObject({ kind: "cookie", capabilities: CAPABILITIES, callbacks: false });
  await expect(qr).toHaveAttribute("data-state", "ready");
  await expect(divider).toHaveText("or scan with Pubky Ring");
  expect(await stored()).toBe("cookie");

  // The choice belongs to this device: the app's page loads again with it.
  await reload();
  await expect(classic).toBeChecked();
  await expect(divider).toHaveText("or scan with Pubky Ring");
  await expect(qr).toHaveAttribute("data-state", "ready");
  expect(await starts()).toEqual(["cookie"]);
});

test("the settings tray's hint takes no room until it has something to say", async ({
  page,
  baseURL,
}) => {
  await openClient(page, baseURL!);
  const element = page.locator("pubky-passport");
  await element.locator('[part="settings"]').click();
  const tray = element.locator('[part="tray"]');
  const form = element.locator('[data-slot="picker"]');
  const field = form.locator("label");
  const hint = element.locator('[data-slot="picker-hint"]');
  const input = element.locator('[data-slot="picker-input"]');
  await expect(input).toBeFocused();
  await expect(tray).toHaveCSS("padding-top", "12px");
  // Empty: the form is just its field, with no line or gap kept for the hint.
  await expect(hint).toBeEmpty();
  const emptyForm = (await form.boundingBox())!;
  const fieldBox = (await field.boundingBox())!;
  expect(Math.abs(emptyForm.height - fieldBox.height)).toBeLessThanOrEqual(1);
  expect(await hint.evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
  // A typed address that cannot be used: its validation line shows under the field.
  await input.fill("http://insecure.example");
  await expect(hint).not.toBeEmpty();
  await expect(hint).toBeVisible();
  const hintBox = (await hint.boundingBox())!;
  expect(hintBox.height).toBeGreaterThan(10);
  expect(hintBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
  expect((await form.boundingBox())!.height).toBeGreaterThan(emptyForm.height + 10);
  // Cleared, it takes no room again.
  await input.fill("");
  await expect(hint).toBeEmpty();
  await expect
    .poll(async () => (await form.boundingBox())!.height)
    .toBeCloseTo(emptyForm.height, 0);
});

test("the headless client's setClassicQr shows the choice in its view", async ({
  page,
  baseURL,
}) => {
  await openClient(page, baseURL!);
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__facade.headless({
      appName: "ClientFixture",
      capabilities: "/pub/example.app/:rw",
    }),
  );
  const classicQr = () =>
    page.evaluate(
      () => (window as unknown as FixtureWindow).__facade.headlessClient.describe().classicQr,
    );
  const told = () =>
    page.evaluate(() => (window as unknown as FixtureWindow).__facade.headlessViews);
  expect(await classicQr()).toBe(false);

  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__facade.headlessClient.setClassicQr(true),
  );
  expect(await classicQr()).toBe(true);
  await expect.poll(told).toContain(true);
  expect(
    await page.evaluate(() => localStorage.getItem("pubky-passport-client/keychain-auth/v1")),
  ).toBe("cookie");

  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__facade.headlessClient.setClassicQr(false),
  );
  expect(await classicQr()).toBe(false);
  await expect.poll(async () => (await told()).at(-1)).toBe(false);
  expect(
    await page.evaluate(() => localStorage.getItem("pubky-passport-client/keychain-auth/v1")),
  ).toBeNull();
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
  await expect(
    popup.getByText(
      "The app you’re signing in to needs a public profile. Add at least a name to continue.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(popup.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
  await popup.getByLabel("Name", { exact: true }).fill("Fixture Person");
  await popup.getByRole("button", { name: "Continue", exact: true }).click();

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
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // The same tab has no opener to bind: the request names nobody (M3).
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  // The address bar lost the request and its requirement.
  expect(new URL(page.url()).hash).toBe("");
});

/** Passport's relay for its Ring profile grant, answered the way `mockRingNetwork` answers it. */
function ringRelay(): { net: RingNetwork; relay: (route: Route) => Promise<void> } {
  const net = newRingNetwork();
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

/** Ring approves Passport's own write-only profile grant, as its "Open keychain app" link asks. */
async function ringApprovesProfileGrant(popup: Page, net: RingNetwork): Promise<void> {
  const link = popup
    .getByRole("region", { name: "Keychain connection" })
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
  // Nothing saved in Passport: the request's start page, Join, offers Pubky Ring under its cards,
  // since the small element offers no keychain route of its own (the fake SDK's link is the
  // legacy kind, which only Pubky Ring approves).
  await expect(popup.getByRole("heading", START_HEADING)).toBeVisible();
  await popup.getByRole("button", { name: "Use Pubky Ring", exact: true }).click();
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
 * Passport's keychain profile-grant screen as an app's sign-in reaches it: its own heading and a
 * lead naming `app`, instead of the plain "Connect your keychain." of Passport's home.
 */
async function expectAppProfileGrantScreen(popup: Page, app: string): Promise<void> {
  await expect(popup.getByRole("heading", { name: "Set up your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(popup.getByRole("heading", { name: "Connect your keychain." })).toHaveCount(0);
  await expect(
    popup.getByText(
      `You’re signed in, but ${app} needs a public profile. Approve in your keychain so Passport can create it.`,
    ),
  ).toBeVisible();
}

async function publishProfile(popup: Page, name: string): Promise<void> {
  await expect(popup.getByRole("heading", { name: "Create your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    popup.getByText(
      "The app you’re signing in to needs a public profile. Add at least a name to continue.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(popup.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await popup.getByLabel("Name", { exact: true }).fill(name);
  await popup.getByRole("button", { name: "Continue", exact: true }).click();
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
  await expect(popup.getByRole("region", { name: "Keychain connection" })).toBeVisible();
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
  // Approved before Passport closed, Passport's profile grant was stored for that key.
  const approved = closedDuring === "the editor";
  test(`Passport closed during ${closedDuring}: the button reopens the profile setup for that key, ${approved ? "connected by its stored grant" : "which asks the keychain"}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const { popup, net, written } = await signInThroughRing(page, baseURL!);
    await expectAppProfileGrantScreen(popup, "client.example");
    if (approved) {
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
    const polls = () => net.relayRequests.filter((request) => request.startsWith("GET ")).length;
    const polled = polls();
    // Clicking reopens Passport straight on this key's profile setup, never the start page.
    const reopened = page.waitForEvent("popup");
    await button.click();
    const profilePage = await reopened;
    await expect(profilePage).toHaveURL(new URL("/", baseURL!).href);
    if (approved) {
      // The grant Ring approved is restored for that key: the editor opens without the keychain.
      await expect(profilePage.getByRole("heading", { name: "Create your profile." })).toBeVisible({
        timeout: 20_000,
      });
      await expect(profilePage.getByRole("region", { name: "Keychain connection" })).toHaveCount(0);
      expect(polls()).toBe(polled);
    } else {
      // Reopened without the request, nothing names the app: the same screen says "this app".
      await expectAppProfileGrantScreen(profilePage, "this app");
      await ringApprovesProfileGrant(profilePage, net);
    }
    await expect(profilePage.getByRole("heading", { name: "Let’s join Pubky." })).toHaveCount(0);
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
  await expect(home.getByRole("heading", { name: "Connect your keychain." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(home.getByText(/You’re signed in/u)).toHaveCount(0);
  await expect(
    home.getByText("Approve in your keychain so Passport can edit your public profile.", {
      exact: true,
    }),
  ).toBeVisible();
  await ringApprovesProfileGrant(home, net);
  await expect(home.getByRole("heading", { name: "Create your profile." })).toBeVisible({
    timeout: 20_000,
  });
  await home.getByLabel("Name", { exact: true }).fill("Ring Person");
  await home.getByRole("button", { name: "Continue", exact: true }).click();
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

/** The app's side of an edit link it opens itself: the pop-up, its hellos and what comes back. */
async function openEditLink(page: Page, baseURL: string, key: string) {
  const passport = new URL(baseURL).origin;
  const popup = page.waitForEvent("popup");
  await page.evaluate(
    ({ passport, key }) => {
      const state = { messages: [] as unknown[], window: null as Window | null };
      (window as unknown as { __edit: typeof state }).__edit = state;
      addEventListener("message", (event) => {
        if (event.origin === passport && event.source === state.window)
          state.messages.push(event.data);
      });
      state.window = window.open(`${passport}/#edit-profile=${key}`, "edit-profile", "popup");
    },
    { passport, key },
  );
  const hello = () =>
    page.evaluate(
      ({ passport, key }) =>
        (window as unknown as { __edit: { window: Window } }).__edit.window.postMessage(
          {
            type: "pubky-passport.hello",
            version: 2,
            attemptId: "edit-profile-attempt-01",
            features: [],
            editProfileKey: key,
          },
          passport,
        ),
      { passport, key },
    );
  const messages = () =>
    page.evaluate(
      () => (window as unknown as { __edit: { messages: { type: string }[] } }).__edit.messages,
    );
  return { popup: await popup, hello, messages };
}

test("an app's edit link opens that identity's editor, tells only that app it is updated and closes", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await seedProfileIdentity(page, false);
  const written = new Map([["/pub/pubky.app/profile.json", JSON.stringify({ name: "Before" })]]);
  await openClient(page, baseURL!, { homeserver: writableHomeserver(written) });
  const edit = await openEditLink(page, baseURL!, PROFILE_KEY);
  await expect
    .poll(async () => {
      await edit.hello();
      return (await edit.messages()).at(-1);
    })
    .toMatchObject({ type: "pubky-passport.ready", request: { status: "empty" } });
  // The editor of exactly that key, with its published profile, and no setup steps or skip.
  const name = edit.popup.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Before", { timeout: 20_000 });
  expect(new URL(edit.popup.url()).hash).toBe("");
  await expect(edit.popup.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await name.fill("After");
  const closed = edit.popup.waitForEvent("close", { timeout: 20_000 });
  await edit.popup.getByRole("button", { name: "Save", exact: true }).click();
  // Saved: the app's pop-up closes at once, with no outcome screen of its own.
  await closed;
  expect(JSON.parse(written.get("/pub/pubky.app/profile.json")!)).toMatchObject({ name: "After" });
  // Only profile.json and avatar media are written, and the app hears the key, nothing else.
  expect(
    [...written.keys()].every(
      (path) =>
        path === "/pub/pubky.app/profile.json" ||
        path.startsWith("/pub/pubky.app/files/") ||
        path.startsWith("/pub/pubky.app/blobs/"),
    ),
  ).toBe(true);
  const updated = (await edit.messages()).filter(
    (message) => message.type === "pubky-passport.profile-updated",
  );
  expect(updated).toEqual([
    {
      type: "pubky-passport.profile-updated",
      version: 2,
      attemptId: "edit-profile-attempt-01",
      publicKey: PROFILE_KEY,
    },
  ]);
});

test("a plain edit link works without an opener and goes back, or home; a key not here or a bad link edits nothing", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await seedProfileIdentity(page, false);
  const written = new Map([["/pub/pubky.app/profile.json", JSON.stringify({ name: "Plain" })]]);
  const homeserver = writableHomeserver(written);
  await page.context().route(/^https:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/u, async (route) => {
    const url = new URL(route.request().url());
    if (PKARR_RELAY_HOSTS.has(url.hostname)) {
      const body = homeserverRecord(url.pathname.slice(1));
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    }
    if (url.hostname === "homeserver.example") return homeserver(route);
    return route.abort();
  });
  // A link loads the document: leave first, as a link from an app's page would arrive. Saved, the
  // tab goes back to that page (it may not close: it has a page before this one).
  await page.goto("/privacy-policy");
  await page.goto(`/#edit-profile=${PROFILE_KEY}`);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Plain", { timeout: 20_000 });
  await page.getByLabel("Name", { exact: true }).fill("Plain Edited");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy-policy$/u, { timeout: 20_000 });
  expect(JSON.parse(written.get("/pub/pubky.app/profile.json")!)).toMatchObject({
    name: "Plain Edited",
  });

  // A tab with no page before it (a link's new tab, `noopener`), in a browser that refuses to let
  // it close: Passport's home.
  await page.context().addInitScript(() => {
    window.close = () => undefined;
  });
  const opened = page.context().waitForEvent("page");
  await page.evaluate(
    (link) => window.open(link, "_blank", "noopener"),
    `/#edit-profile=${PROFILE_KEY}`,
  );
  const fresh = await opened;
  await fresh.waitForLoadState();
  expect(await fresh.evaluate(() => history.length)).toBe(1);
  await expect(fresh.getByLabel("Name", { exact: true })).toHaveValue("Plain Edited", {
    timeout: 20_000,
  });
  await fresh.getByRole("button", { name: "Save", exact: true }).click();
  await expect(fresh.getByRole("heading", { name: "Your pubky." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(fresh.getByText("Profile published")).toBeVisible();
  await expect(fresh.getByRole("heading", { name: "Profile updated." })).toHaveCount(0);
  await fresh.close();

  // A key this Passport does not hold: only Pubky Ring, bound to that key, can connect it.
  const other = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
  await page.goto("/privacy-policy");
  await page.goto(`/#edit-profile=${other}`);
  await expect(page.getByRole("heading", { name: "Connect your keychain." })).toBeVisible();
  await expect(page.getByText(/This pubky is not saved in this Passport/u)).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);

  for (const link of ["/#edit-profile=not-a-key", `/#edit-profile=${PROFILE_KEY}&x=1`]) {
    await page.goto("/privacy-policy");
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Invalid profile link." })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
  }
  expect(JSON.parse(written.get("/pub/pubky.app/profile.json")!)).toMatchObject({
    name: "Plain Edited",
  });
});

test("hero, header and footer in one sync-group share a sign-in and announce its Session once", async ({
  page,
  baseURL,
}) => {
  await seedProfileIdentity(page, false);
  await openClient(page, baseURL!, { syncGroup: "pubky.app" });
  // The app paints the whole pill yellow in every state through the published parts.
  await page.addStyleTag({
    content:
      "pubky-passport::part(button),pubky-passport::part(settings),pubky-passport::part(cancel){background:rgb(255, 213, 0)}",
  });
  const member = (id: string) => page.locator(`#${id}`);
  const popupOpened = page.waitForEvent("popup");
  await member("footer").locator('[part="button"]').click();
  const popup = await popupOpened;
  await expect
    .poll(async () => (await facade(page)).state)
    .toMatchObject({ status: "waiting", handshake: "confirmed" });
  for (const id of ["button", "header", "footer"]) {
    await expect(member(id).locator('[part="button"]')).toHaveText("Continue in Passport");
    const cancel = member(id).locator('[part="cancel"]');
    await expect(cancel).toHaveAttribute("aria-label", "Cancel");
    await expect(cancel).toHaveCSS("background-color", "rgb(255, 213, 0)");
  }
  // The scroll-revealed header unmounts mid-sign-in: the attempt and its window go on.
  await page.evaluate(() => document.querySelector("#header")!.remove());
  await expect(popup.getByRole("heading", { name: "Signing in to ClientFixture" })).toBeVisible();
  await popup.getByRole("button", { name: "Authorize", exact: true }).click();
  await expect.poll(async () => (await facade(page)).state.status).toBe("signed-in");
  // One Session for the whole group, announced by its first member still on the page.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __facade: { sessionTargets: string[] } }).__facade.sessionTargets,
      ),
    )
    .toEqual(["button"]);
  expect((await facade(page)).publicKeys).toEqual([PROFILE_KEY]);
  for (const id of ["button", "footer"])
    await expect(member(id).locator('[part="button"]')).toHaveCount(0);
  // reset() on one member brings the button back on all of them.
  await page.evaluate(() => (window as unknown as FixtureWindow).__facade.reset());
  for (const id of ["button", "footer"])
    await expect(member(id).locator('[part="button"]')).toHaveText("Continue with Pubky");
});
