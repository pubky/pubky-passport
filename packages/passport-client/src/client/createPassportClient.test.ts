import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakePopupWindow } from "../../test/FakePopupPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import type { InternalClientOptions } from "../config/PassportClientOptions.js";
import type { FlowCallbacks, FlowPort } from "../flow/FlowPort.js";
import { validateCapabilities } from "../flow/pubkyFlowAdapter.js";
import { requestDigest } from "../shared/requestDigest.js";
import type { ClientPlatform } from "./ClientRuntime.js";
import { createClient, createPassportClient, publicClient } from "./createPassportClient.js";
import type { InternalClient } from "./InternalClient.js";

const PASSPORT = "https://passport.example";
const APP = "https://app.example";
const KEY = "pubky-passport:redirect:v1";
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

function fakePage(href = `${APP}/`, sessionStorage = new MemoryStorage()) {
  const url = new URL(href);
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const assign = vi.fn<(url: string) => void>();
  const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
    location.href = next;
  });
  const location = {
    href: url.href,
    origin: url.origin,
    hostname: url.hostname,
    pathname: url.pathname,
    protocol: url.protocol,
    assign,
  };
  const page = Object.assign(new EventTarget(), {
    location,
    document,
    localStorage: new MemoryStorage(),
    sessionStorage,
    history: { state: null, replaceState },
    navigator: { userAgent: "Mozilla/5.0 Test", userActivation: { isActive: true } },
    crypto: globalThis.crypto,
    opener: null as unknown,
    screen: { availHeight: 900 },
    open: vi.fn(),
  });
  Object.assign(page, { top: page, self: page });
  return { page: page as unknown as Window & typeof page, assign, replaceState, sessionStorage };
}

interface Harness {
  client: InternalClient;
  clock: FakeClock;
  flows: FakeFlowPort[];
  starts: (FlowCallbacks | undefined)[];
  resumes: string[];
  opened: string[];
  page: ReturnType<typeof fakePage>;
  platform: ClientPlatform;
  diagnostics: ReturnType<typeof vi.fn>;
}
const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    h.client.dispose();
    for (const flow of h.flows) if (flow.pending) flow.settle();
    await flush();
    h.clock.advance(5000);
    await flush();
    for (const flow of h.flows) if (flow.reads || flow.polls) flow.assertFreed();
  }
});

function setup(
  options: InternalClientOptions = {},
  page = fakePage(),
  windows: (Window | null)[] = [],
): Harness {
  const clock = new FakeClock();
  const flows: FakeFlowPort[] = [];
  const starts: (FlowCallbacks | undefined)[] = [];
  const resumes: string[] = [];
  const opened: string[] = [];
  const port: FlowPort = {
    async start(callbacks) {
      starts.push(callbacks);
      const flow = new FakeFlowPort(
        `pubkyauth://signin?secret=${["private", flows.length].join("-")}`,
      );
      flows.push(flow);
      return { ok: true, value: flow };
    },
    async resume(saved) {
      resumes.push(saved);
      const flow = new FakeFlowPort("pubkyauth://resumed");
      flows.push(flow);
      return { ok: true, value: flow };
    },
    sessionInfo: () => ({ ok: true, value: { publicKey: "approved-key", capabilities: [] } }),
  };
  const platform: ClientPlatform = {
    available: () => true,
    window: () => page.page,
    clock,
    flowPort: () => port,
    readProfile: vi.fn(async () => ({ kind: "found" as const, profile: { name: "Approved" } })),
    validateCapabilities,
  };
  const diagnostics = vi.fn();
  const client = createClient(
    {
      instance: PASSPORT,
      onDiagnostic: diagnostics,
      ...options,
      development: {
        openWindow: (url: string) => {
          opened.push(url);
          return windows.length ? windows.shift()! : null;
        },
        ...options.development,
      },
    },
    platform,
  );
  const h: Harness = { client, clock, flows, starts, resumes, opened, page, platform, diagnostics };
  harnesses.push(h);
  return h;
}

function reply(h: Harness, popup: Window, data: unknown) {
  const event = new Event("message");
  Object.defineProperties(event, {
    origin: { value: PASSPORT },
    source: { value: popup },
    data: { value: data },
  });
  h.page.page.dispatchEvent(event);
}

function live() {
  const fake = new FakePopupWindow();
  fake.documentAllowed = true;
  return fake;
}

test("a popup sign-in navigates to /authorize, confirms v2 and delivers the Session once", async () => {
  const popup = live();
  const h = setup({ profile: "optional" }, fakePage(), [popup.window]);
  const sessions = vi.fn();
  const states: string[] = [];
  h.client.onSession(sessions);
  h.client.subscribe((state) => states.push(state.status));
  const result = h.client.signIn();
  expect(h.opened).toEqual(["about:blank"]);
  expect(h.client.getState().status).toBe("opening");
  await flush();
  const flow = h.flows[0]!;
  expect(popup.navigations).toEqual([`${PASSPORT}/authorize#d=${encodeURIComponent(flow.url)}`]);
  expect(h.starts).toEqual([undefined]);
  const hello = popup.posts[0]!;
  expect(hello).toMatchObject({
    origin: PASSPORT,
    message: {
      type: "pubky-passport.hello",
      version: 2,
      profile: "optional",
      // A40: the hello names exactly this request by digest, never by its secret-bearing URL.
      request: requestDigest(flow.url),
    },
  });
  expect(JSON.stringify(popup.posts)).not.toContain("private");
  const attemptId = (hello.message as { attemptId: string }).attemptId;
  reply(h, popup.window, {
    type: "pubky-passport.ready",
    version: 2,
    attemptId,
    protocols: [1, 2],
    features: ["outcome-v2", "status"],
    request: { status: "valid" },
  });
  expect(h.client.getState()).toMatchObject({ status: "waiting", handshake: "confirmed" });
  const session = new FakeSession();
  flow.settle(session.session);
  await flush();
  expect(await result).toMatchObject({
    status: "signed-in",
    session: session.session,
    info: { publicKey: "approved-key", profile: { name: "Approved" } },
  });
  expect(sessions).toHaveBeenCalledExactlyOnceWith(session.session, expect.anything());
  expect(h.client.describe().hidden).toBe(true);
  expect(popup.closeCalls).toBe(1);
  expect(states).toEqual(["opening", "opening", "waiting", "finishing", "signed-in"]);
  expect(JSON.stringify(h.client.getState())).not.toContain("private");
  session.session.free();
  h.client.reset();
  expect(h.client.getState().status).toBe("idle");
  popup.assertHealthy();
});

test("a required profile holds the Session until the public profile check finds it", async () => {
  const popup = live();
  const h = setup({}, fakePage(), [popup.window]);
  const result = h.client.signIn();
  await flush();
  expect(popup.posts[0]?.message).toMatchObject({ profile: "required" });
  const session = new FakeSession();
  h.flows[0]!.settle(session.session);
  await flush();
  expect(h.platform.readProfile).toHaveBeenCalledWith("approved-key", undefined, undefined);
  expect(await result).toMatchObject({ status: "signed-in" });
  session.session.free();
});

test("a blocked popup continues in this tab and the return page resumes the saved flow", async () => {
  const first = setup({ profile: "optional" }, fakePage(`${APP}/return?tab=1#top`), [null]);
  const result = first.client.signIn();
  expect(first.opened).toEqual(["about:blank"]);
  await flush();
  const callbacks = first.starts[0]!;
  expect(callbacks?.xSuccess).toMatch(
    new RegExp(`^${APP}/return\\?pubky-passport=s\\.[A-Za-z0-9_-]{22}$`, "u"),
  );
  expect(await result).toEqual({ status: "redirecting" });
  const flow = first.flows[0]!;
  expect(first.page.assign).toHaveBeenCalledExactlyOnceWith(
    `${PASSPORT}/authorize#d=${encodeURIComponent(flow.url)}`,
  );
  expect(first.page.page.opener).toBeNull();
  const saved = JSON.parse(first.page.sessionStorage.getItem(KEY)!);
  expect(saved).toMatchObject({ state: `delegated:${flow.url}`, instance: PASSPORT });
  expect(saved).not.toHaveProperty("returnPath");
  // The initiating page is gone; a fresh page load returns with the success marker.
  const returned = fakePage(callbacks!.xSuccess!, first.page.sessionStorage);
  const second = setup({ profile: "optional" }, returned);
  const sessions = vi.fn();
  second.client.onSession(sessions);
  // Creation consumed the return; asking again reports nothing new.
  expect(second.client.handleReturn()).toBe("none");
  expect(second.resumes).toEqual([`delegated:${flow.url}`]);
  expect(returned.sessionStorage.getItem(KEY)).toBeNull();
  expect(returned.page.location.href).toBe(`${APP}/return`);
  expect(second.client.getState()).toMatchObject({ status: "finishing", via: "redirect" });
  await flush();
  const session = new FakeSession();
  second.flows[0]!.settle(session.session);
  await flush();
  expect(second.client.getState().status).toBe("signed-in");
  expect(sessions).toHaveBeenCalledOnce();
  session.session.free();
});

test("handleReturn without a marker or record reports none, and a marker without one is stray", async () => {
  const h = setup({ profile: "optional" }, fakePage(), [live().window]);
  void h.client.signIn();
  expect(h.client.handleReturn()).toBe("none");
  h.client.cancel();
  expect(h.client.handleReturn()).toBe("none");
  const stray = setup({}, fakePage(`${APP}/?pubky-passport=s.${"A".repeat(22)}`));
  expect(stray.client.handleReturn()).toBe("stray");
  expect(stray.page.page.location.href).toBe(`${APP}/`);
  expect(stray.resumes).toEqual([]);
});

test("instance choices are refused while live, withdraw old flows and reset to the default", async () => {
  const popup = live();
  const h = setup({ profile: "optional" }, fakePage(), [popup.window]);
  void h.client.signIn();
  expect(h.client.setInstance("custom.example")).toMatchObject({
    ok: false,
    code: "attempt_in_progress",
    message: "Finish or cancel the current sign-in first.",
  });
  h.client.cancel();
  expect(h.client.setInstance("custom.example")).toMatchObject({
    ok: true,
    instance: { origin: "https://custom.example", isCustom: true },
  });
  expect(h.client.getState().instance.origin).toBe("https://custom.example");
  expect(h.client.describe().notice).toBe("Using Passport at custom.example");
  expect(h.client.getInstance().origin).toBe("https://custom.example");
  h.client.resetInstance();
  expect(h.client.getInstance()).toMatchObject({ origin: PASSPORT });
  expect(h.client.getState().instance.origin).toBe(PASSPORT);
});

test("the public view names the selected Passport, a chosen one as custom", async () => {
  const page = fakePage();
  const h = setup({}, page);
  const client = publicClient(h.client);
  expect(client.describe().instance).toEqual({ origin: PASSPORT, isCustom: false });
  expect(h.client.setInstance("custom.example")).toMatchObject({ ok: true });
  expect(client.describe().instance).toEqual({
    origin: "https://custom.example",
    isCustom: true,
  });
  expect(Object.isFrozen(client.describe().instance)).toBe(true);
  // A later client on the page reads the same choice.
  const next = publicClient(setup({}, page).client);
  expect(next.describe().instance).toEqual({ origin: "https://custom.example", isCustom: true });
  h.client.resetInstance();
  expect(client.describe().instance).toEqual({ origin: PASSPORT, isCustom: false });
});

test("a disposed client keeps its snapshot and returns inert or internal results", async () => {
  const h = setup();
  const before = h.client.getState();
  h.client.dispose();
  h.client.dispose();
  expect(h.client.getState()).toEqual(before);
  expect(await h.client.signIn()).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(h.client.setInstance("custom.example")).toMatchObject({ ok: false, code: "internal" });
  // The return the client consumed at creation stays its memoized result (A36).
  expect(h.client.handleReturn()).toBe("none");
  const lease = h.client.prepare();
  lease.ringOpened();
  lease.release();
  const unsubscribe = h.client.subscribe(vi.fn());
  expect(unsubscribe()).toBeUndefined();
  h.client.perform("sign-in");
  expect(h.opened).toEqual([]);
});

test("the package entry constructs without a browser and the first browser call stays safe", async () => {
  const client = createPassportClient();
  expect(client.describe()).toEqual({
    label: "Continue with Pubky",
    tone: "neutral",
    busy: false,
    instance: { origin: "https://passport.pubky.app", isCustom: false },
  });
  const reference = setup();
  const window = vi.fn(() => reference.page.page);
  // Created where no browser is available (a server render), nothing browser-side runs.
  const unavailable = createClient(
    { instance: PASSPORT },
    { ...reference.platform, available: () => false, window },
  );
  expect(await unavailable.signIn()).toMatchObject({
    status: "failed",
    error: { code: "unsupported_environment" },
  });
  expect(unavailable.handleReturn()).toBe("none");
  expect(window).not.toHaveBeenCalled();
  client.dispose();
});

test("diagnostics reach the option; a throwing observer is contained", async () => {
  const h = setup({ profile: "optional" }, fakePage(), [live().window]);
  h.diagnostics.mockImplementation(() => {
    throw new Error("observer");
  });
  h.page.page.navigator.userActivation.isActive = false;
  void h.client.signIn();
  await flush();
  expect(h.diagnostics).toHaveBeenCalledWith(
    expect.objectContaining({ code: "no_user_activation" }),
  );
  expect(h.client.getState().status).toBe("opening");
});

test("the first client on a return page consumes the same-tab return without any app call", async () => {
  const first = setup({ profile: "optional" }, fakePage(`${APP}/return`), [null]);
  await first.client.signIn();
  await flush();
  const callbacks = first.starts[0]!;
  const returned = fakePage(callbacks!.xSuccess!, first.page.sessionStorage);
  const second = setup({ profile: "optional" }, returned);
  // Creation alone resumed the saved flow and cleaned the address bar.
  expect(second.resumes).toHaveLength(1);
  expect(returned.page.location.href).toBe(`${APP}/return`);
  expect(second.client.getState()).toMatchObject({ status: "finishing", via: "redirect" });
  await flush();
  const session = new FakeSession();
  second.flows[0]!.settle(session.session);
  await flush();
  expect(second.client.getState().status).toBe("signed-in");
  session.session.free();
});

test("the public client returns the Session with its key and profile and keeps it until reset()", async () => {
  const popup = live();
  const h = setup({}, fakePage(), [popup.window]);
  const client = publicClient(h.client);
  const views: ReturnType<typeof client.describe>[] = [];
  client.subscribe((view) => views.push(view));
  const result = client.signIn();
  await flush();
  const session = new FakeSession();
  h.flows[0]!.settle(session.session);
  const settled = await result;
  expect(settled).toEqual({
    status: "signed-in",
    session: session.session,
    publicKey: "approved-key",
    profile: { name: "Approved" },
    instance: PASSPORT,
  });
  await flush();
  const signedIn = {
    session: session.session,
    publicKey: "approved-key",
    profile: { name: "Approved" },
    instance: PASSPORT,
  };
  expect(client.describe()).toEqual({
    label: "",
    tone: "success",
    busy: false,
    signedIn,
    instance: { origin: PASSPORT, isCustom: false },
  });
  expect(views.at(-1)).toEqual(client.describe());
  // The state change and the Session that follows it reach listeners as one view.
  expect(views.filter((view) => view.label === "" && !view.signedIn)).toEqual([]);
  client.reset();
  await flush();
  expect(client.describe()).toEqual({
    label: "Continue with Pubky",
    tone: "neutral",
    busy: false,
    instance: { origin: PASSPORT, isCustom: false },
  });
  expect(views.at(-1)?.signedIn).toBeUndefined();
  session.session.free();
});

test("a same-tab return hands its Session to the public view without any app call", async () => {
  const first = setup({}, fakePage(`${APP}/return`), [null]);
  expect(await publicClient(first.client).signIn()).toEqual({ status: "redirecting" });
  await flush();
  // Passport reads the profile requirement next to the request.
  expect(first.page.assign.mock.calls[0]![0]).toMatch(/\/authorize#d=.+&profile=required$/u);
  const returned = fakePage(first.starts[0]!.xSuccess!, first.page.sessionStorage);
  const second = setup({}, returned);
  const client = publicClient(second.client);
  const listener = vi.fn();
  client.subscribe(listener);
  await flush();
  const session = new FakeSession();
  second.flows[0]!.settle(session.session);
  await flush();
  expect(client.describe().signedIn).toEqual({
    session: session.session,
    publicKey: "approved-key",
    profile: { name: "Approved" },
    instance: PASSPORT,
  });
  expect(listener).toHaveBeenLastCalledWith(client.describe());
  session.session.free();
});

test("reset() cancels a sign-in in progress", async () => {
  const popup = live();
  const h = setup({}, fakePage(), [popup.window]);
  const client = publicClient(h.client);
  const result = client.signIn();
  await flush();
  expect(client.describe()).toMatchObject({ busy: true, tone: "busy" });
  client.reset();
  expect(await result).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(client.describe()).toEqual({
    label: "Continue with Pubky",
    tone: "neutral",
    busy: false,
    instance: { origin: PASSPORT, isCustom: false },
  });
});

test("signing in again while a required profile is missing opens Passport's profile page", async () => {
  const popup = live();
  const h = setup({}, fakePage(), [popup.window]);
  vi.mocked(h.platform.readProfile).mockResolvedValue({ kind: "missing" });
  const client = publicClient(h.client);
  const result = client.signIn();
  await flush();
  const session = new FakeSession();
  h.flows[0]!.settle(session.session);
  await flush();
  expect(client.describe()).toMatchObject({ label: "Finish your profile", tone: "warning" });
  const again = client.signIn();
  expect(h.opened.at(-1)).toBe(`${PASSPORT}/#profile=approved-key`);
  vi.mocked(h.platform.readProfile).mockResolvedValue({
    kind: "found",
    profile: { name: "New" },
  });
  h.page.page.dispatchEvent(new Event("focus"));
  await flush();
  for (const pending of [result, again])
    expect(await pending).toMatchObject({ status: "signed-in", profile: { name: "New" } });
  session.session.free();
});

test("a Passport that offers profile setup creates the missing profile before the app signs in", async () => {
  const popup = live();
  const h = setup({}, fakePage(), [popup.window]);
  const read = vi.mocked(h.platform.readProfile);
  read.mockResolvedValue({ kind: "missing" });
  const client = publicClient(h.client);
  const result = client.signIn();
  await flush();
  const attemptId = (popup.posts[0]!.message as { attemptId: string }).attemptId;
  reply(h, popup.window, {
    type: "pubky-passport.ready",
    version: 2,
    attemptId,
    protocols: [1, 2],
    features: ["outcome-v2", "status", "profile-setup"],
    request: { status: "valid" },
  });
  const session = new FakeSession();
  h.flows[0]!.settle(session.session);
  await flush();
  // Held, not delivered: Passport is asked, in its open window, for exactly this key.
  expect(h.client.getState()).toMatchObject({ status: "needs-profile", passport: "open" });
  expect(popup.window.closed).toBe(false);
  expect(popup.posts.at(-1)).toEqual({
    origin: PASSPORT,
    message: {
      type: "pubky-passport.profile-needed",
      version: 2,
      attemptId,
      publicKey: "approved-key",
    },
  });
  expect(client.describe()).toMatchObject({ label: "Finish your profile in Passport" });
  read.mockResolvedValue({ kind: "found", profile: { name: "Ring Person" } });
  reply(h, popup.window, { type: "pubky-passport.profile-ready", version: 2, attemptId });
  await flush();
  expect(await result).toMatchObject({
    status: "signed-in",
    session: session.session,
    profile: { name: "Ring Person" },
  });
  expect(popup.window.closed).toBe(true);
  session.session.free();
});

test("after Passport was closed, the button reopens its profile page bound to the attempt", async () => {
  const first = live();
  const profilePage = live();
  const h = setup({}, fakePage(), [first.window, profilePage.window]);
  const read = vi.mocked(h.platform.readProfile);
  read.mockResolvedValue({ kind: "missing" });
  const client = publicClient(h.client);
  const result = client.signIn();
  await flush();
  const attemptId = (first.posts[0]!.message as { attemptId: string }).attemptId;
  reply(h, first.window, {
    type: "pubky-passport.ready",
    version: 2,
    attemptId,
    protocols: [1, 2],
    features: ["outcome-v2", "status", "profile-setup"],
    request: { status: "valid" },
  });
  const session = new FakeSession();
  h.flows[0]!.settle(session.session);
  await flush();
  first.closed = true; // the person closes Passport
  h.clock.advance(1000);
  await flush();
  // Closed by hand: the Session stays held and the button offers the profile again.
  expect(h.client.getState()).toMatchObject({ status: "needs-profile" });
  expect(h.client.getState()).not.toHaveProperty("passport");
  expect(session.signouts).toBe(0);
  expect(client.describe()).toMatchObject({ label: "Finish your profile" });
  const again = client.signIn();
  expect(h.opened.at(-1)).toBe(`${PASSPORT}/#profile=approved-key`);
  expect(profilePage.posts[0]).toMatchObject({
    origin: PASSPORT,
    message: { type: "pubky-passport.hello", attemptId, profileKey: "approved-key" },
  });
  expect(profilePage.posts[0]!.message).not.toHaveProperty("request");
  read.mockResolvedValue({ kind: "found", profile: { name: "Ring Person" } });
  reply(h, profilePage.window, { type: "pubky-passport.profile-ready", version: 2, attemptId });
  await flush();
  for (const pending of [result, again])
    expect(await pending).toMatchObject({ status: "signed-in", profile: { name: "Ring Person" } });
  expect(profilePage.window.closed).toBe(true);
  session.session.free();
});
