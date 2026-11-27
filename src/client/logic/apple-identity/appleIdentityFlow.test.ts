/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { expectResultOk } from "@test-utils/resultAssertions";
import { AppleIdentityController, type AppleIdentityViewState } from "./AppleIdentityController";
import { ICloudConnection } from "./ICloudConnection";
import { APPLE_AUTHORIZE_URL, SignInWithApple } from "./SignInWithApple";

/**
 * The controller with the real iCloud connection and the real Sign in with Apple, against a
 * stand-in browser: only `window.open`, the opened windows, `fetch` and the lifecycle are fakes.
 */
const SERVICES_ID = "app.pubky.passport.signin";
const SUBJECT = "001234.abcdef.1234";
const SESSION = "CLOUDKIT-SESSION";
const SIGN_IN_URL = "https://idmsa.apple.com/IDMSWebAuth/signin?appIdKey=x";
const APPLE_ID = "https://appleid.apple.com";
const CLOUDKIT_AUTH = "https://cdn.apple-cloudkit.com";
const CONFIGURATION = {
  servicesId: SERVICES_ID,
  homegateBaseUrl: "https://homegate.example/",
  icloud: { containerId: "iCloud.app", apiToken: "token", environment: "production" as const },
};

type OpenedWindow = Window & { closed: boolean; location: { href: string } };

function openedWindow(url: string): OpenedWindow {
  const opened = {
    closed: false,
    close: vi.fn(() => {
      opened.closed = true;
    }),
    focus: vi.fn(),
    location: { href: url },
  };
  return opened as unknown as OpenedWindow;
}

function deliver(data: unknown, origin: string, source: unknown) {
  window.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));
}

/** What Apple's authorize page posts for the request in `authorizeUrl`. */
function appleReply(authorizeUrl: string) {
  const url = new URL(authorizeUrl);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    method: "oauthDone",
    data: {
      authorization: {
        state: url.searchParams.get("state"),
        code: "code",
        id_token: `${encode({ alg: "RS256" })}.${encode({
          iss: APPLE_ID,
          aud: SERVICES_ID,
          sub: SUBJECT,
          nonce: url.searchParams.get("nonce"),
          iat: now,
          exp: now + 600,
        })}.c2ln`,
      },
    },
  });
}

function setup() {
  const windows: OpenedWindow[] = [];
  const open = vi.fn((url?: string | URL) => {
    const opened = openedWindow(String(url));
    windows.push(opened);
    return opened;
  });
  window.open = open as unknown as typeof window.open;
  let signInUrls = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
    new URL(String(input)).searchParams.get("ckWebAuthToken")
      ? Response.json({ userRecordName: "_user" })
      : Response.json(
          {
            serverErrorCode: "AUTHENTICATION_REQUIRED",
            redirectURL: `${SIGN_IN_URL}&n=${++signInUrls}`,
          },
          { status: 421 },
        ),
  );
  const connection = new ICloudConnection(CONFIGURATION.icloud, fetchImpl, window);
  const established = {
    establishmentMode: "created" as const,
    appleAccount: { appleSubject: SUBJECT, email: null, name: null },
    publicIdentity: { publicKeyZ32: "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy" },
  };
  const lifecycle = {
    establishIdentity: vi.fn(async () => Result.ok(established)),
    replaceInvalidPassportFile: vi.fn(async () => Result.ok(established)),
    replaceUndecryptablePassportFile: vi.fn(async () => Result.ok(established)),
    attachIdentity: vi.fn(async () =>
      Result.ok({ attachment: "created" as const, appleAccount: established.appleAccount }),
    ),
    detachIdentity: vi.fn(async () => Result.ok(undefined)),
    abortRequests: vi.fn(),
    dispose: vi.fn(),
  };
  const controller = new AppleIdentityController(CONFIGURATION, {
    signInWithApple: new SignInWithApple(SERVICES_ID, "https://passport.example/", window),
    createICloudConnection: () => connection,
    createLifecycle: () => lifecycle,
    createStore: () => ({}) as never,
  });
  const states: AppleIdentityViewState[] = [];
  controller.subscribe((state) => states.push(state));
  return { controller, fetchImpl, lifecycle, open, states, windows };
}

/**
 * Clicks Continue with Apple and leaves the person in Apple's sheet for a moment, as in real
 * use; the spare iCloud sign-in URL arrives meanwhile.
 */
async function clickContinueWithApple({ controller, fetchImpl, open, windows }: Setup) {
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  const started = controller.continueWithApple();
  expect(open).toHaveBeenCalledOnce();
  const appleWindow = windows[0]!;
  expect(appleWindow.location.href.startsWith(`${APPLE_AUTHORIZE_URL}?`)).toBe(true);
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  await vi.advanceTimersByTimeAsync(20);
  return { appleWindow, authorizeUrl: appleWindow.location.href, started };
}

type Setup = ReturnType<typeof setup>;

function statuses(states: AppleIdentityViewState[]) {
  return states.map((state) => state.status);
}

describe("Apple flow: Sign in with Apple, then iCloud", () => {
  const controllers: AppleIdentityController[] = [];
  function start() {
    vi.useFakeTimers();
    const flow = setup();
    controllers.push(flow.controller);
    return flow;
  }
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("desktop: one click, one window for both Apple sign-ins", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);

    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);
    // The same window goes on to iCloud's sign-in page.
    expect(appleWindow.location.href).toBe(`${SIGN_IN_URL}&n=1`);
    expect(flow.controller.getState().status).toBe("connecting-icloud");
    deliver({ ckSession: SESSION }, CLOUDKIT_AUTH, appleWindow);

    expectResultOk(await started);
    expect(flow.open).toHaveBeenCalledOnce();
    expect(flow.lifecycle.establishIdentity).toHaveBeenCalledOnce();
    expect(statuses(flow.states)).toEqual([
      "requesting-apple",
      "connecting-icloud",
      "establishing",
      "established",
    ]);
    expect(info).toHaveBeenCalledWith("identity.apple.handoff", { path: "same_window" });
  });

  it("desktop: a fast iCloud sign-in whose close is seen before its session still needs one click", async () => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);

    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);
    await vi.advanceTimersByTimeAsync(2_000);
    // Apple's page posts the session and closes itself in one step; focus comes back first.
    appleWindow.closed = true;
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(100);
    deliver({ ckSession: SESSION }, CLOUDKIT_AUTH, appleWindow);

    expectResultOk(await started);
    expect(flow.open).toHaveBeenCalledOnce();
    expect(flow.controller.getState().status).toBe("established");
    expect(statuses(flow.states)).not.toContain("connect-icloud");
  });

  it("iPhone: the window closes right after the handoff; step 2 is ready at once, one more click finishes", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);

    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);
    expect(appleWindow.location.href).toBe(`${SIGN_IN_URL}&n=1`);
    // iOS Safari closes the window when its own Apple sheet is done, and Passport's page is
    // in front again.
    appleWindow.closed = true;
    window.dispatchEvent(new Event("focus"));

    // A moment to confirm the close, not the 5 s on "Finish in Apple's window".
    await vi.advanceTimersByTimeAsync(300);
    expectResultOk(await started);
    // The normal second step: ready, no "Preparing iCloud…", no "window was closed" notice.
    expect(flow.controller.getState()).toEqual({ status: "connect-icloud", ready: true });
    expect(flow.states).not.toContainEqual(expect.objectContaining({ ready: false }));
    expect(info).toHaveBeenCalledWith("identity.apple.handoff", { path: "window_closed" });

    // One more click opens iCloud's page directly, with a URL no window has used.
    const connected = flow.controller.connectICloud();
    expect(flow.open).toHaveBeenCalledTimes(2);
    const icloudWindow = flow.windows[1]!;
    expect(icloudWindow.location.href).toBe(`${SIGN_IN_URL}&n=2`);
    expect(flow.controller.getState().status).toBe("connecting-icloud");
    deliver({ ckSession: SESSION }, CLOUDKIT_AUTH, icloudWindow);

    expectResultOk(await connected);
    expect(flow.lifecycle.establishIdentity).toHaveBeenCalledOnce();
    expect(flow.controller.getState().status).toBe("established");
  });

  it("iPhone: the window is already closed when Apple's reply arrives; same ready second step", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);

    appleWindow.closed = true;
    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);

    expectResultOk(await started);
    expect(statuses(flow.states)).toEqual(["requesting-apple", "connect-icloud"]);
    expect(flow.controller.getState()).toEqual({ status: "connect-icloud", ready: true });
    expect(info).toHaveBeenCalledWith("identity.apple.handoff", { path: "window_closed" });

    // Both sign-in URLs are still unused; the click opens the first.
    const connected = flow.controller.connectICloud();
    expect(flow.windows[1]!.location.href).toBe(`${SIGN_IN_URL}&n=1`);
    deliver({ ckSession: SESSION }, CLOUDKIT_AUTH, flow.windows[1]);
    expectResultOk(await connected);
    expect(flow.controller.getState().status).toBe("established");
  });

  it("a real close of iCloud's window on the second step keeps its notice, and the retry is ready", async () => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);
    appleWindow.closed = true;
    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);
    expectResultOk(await started);

    const connected = flow.controller.connectICloud();
    flow.windows[1]!.closed = true;
    flow.controller.focusICloud();

    expectResultOk(await connected);
    expect(flow.controller.getState()).toEqual({
      status: "connect-icloud",
      ready: true,
      notice: "icloud_sign_in_cancelled",
    });
    expect(flow.states).not.toContainEqual(expect.objectContaining({ ready: false }));
    const retried = flow.controller.connectICloud();
    expect(flow.windows[2]!.location.href).toBe(`${SIGN_IN_URL}&n=2`);
    deliver({ ckSession: SESSION }, CLOUDKIT_AUTH, flow.windows[2]);
    expectResultOk(await retried);
  });

  it("a blocked iCloud window on the second step never shows the waiting screen", async () => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);
    appleWindow.closed = true;
    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);
    expectResultOk(await started);

    flow.open.mockReturnValueOnce(null as never);
    expectResultOk(await flow.controller.connectICloud());

    expect(statuses(flow.states)).not.toContain("connecting-icloud");
    expect(flow.controller.getState()).toEqual({
      status: "connect-icloud",
      ready: true,
      notice: "icloud_popup_blocked",
    });
  });

  it("a hostile window cannot end, extend or complete the handoff", async () => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);
    const hostile = openedWindow("https://evil.example/");

    // Before Apple replied: forged replies and sessions from other windows or origins.
    deliver(appleReply(authorizeUrl), APPLE_ID, hostile);
    deliver(appleReply(authorizeUrl), "https://evil.example", appleWindow);
    deliver({ ckSession: "FORGED" }, CLOUDKIT_AUTH, appleWindow);
    expect(flow.controller.getState().status).toBe("requesting-apple");

    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);
    expect(flow.controller.getState().status).toBe("connecting-icloud");

    // During the handoff: a forged session, and forged "iCloud's page spoke" notices that
    // would bring the 5 s grace back, from the wrong window or the wrong origin.
    deliver({ ckSession: "FORGED" }, CLOUDKIT_AUTH, hostile);
    deliver({ ckSession: "FORGED" }, "https://evil.example", appleWindow);
    deliver({ ckSession: "FORGED" }, APPLE_ID, appleWindow);
    deliver({ errorMessage: "window closed" }, CLOUDKIT_AUTH, hostile);
    deliver({ errorMessage: "window closed" }, "https://evil.example", appleWindow);
    expect(flow.controller.getState().status).toBe("connecting-icloud");

    appleWindow.closed = true;
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(300);
    expectResultOk(await started);
    expect(flow.controller.getState()).toEqual({ status: "connect-icloud", ready: true });

    // After the attempt ended: a late session from the closed window is not read.
    deliver({ ckSession: "LATE" }, CLOUDKIT_AUTH, appleWindow);
    expect(flow.controller.getState()).toEqual({ status: "connect-icloud", ready: true });
    expect(flow.lifecycle.establishIdentity).not.toHaveBeenCalled();
    expect(
      flow.fetchImpl.mock.calls.some(([input]) => String(input).includes("ckWebAuthToken")),
    ).toBe(false);
  });

  it("dispose during the handoff drops the Apple token and never reaches the second step", async () => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const flow = start();
    const { appleWindow, authorizeUrl, started } = await clickContinueWithApple(flow);
    deliver(appleReply(authorizeUrl), APPLE_ID, appleWindow);

    flow.controller.dispose();
    appleWindow.closed = true;

    expect(Result.isError(await started)).toBe(true);
    expect(statuses(flow.states)).toEqual(["requesting-apple", "connecting-icloud"]);
    expect(Result.isError(await flow.controller.connectICloud())).toBe(true);
    expect(flow.open).toHaveBeenCalledOnce();
    expect(flow.lifecycle.establishIdentity).not.toHaveBeenCalled();
  });
});
