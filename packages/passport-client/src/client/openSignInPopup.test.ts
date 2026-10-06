import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakePopupWindow } from "../../test/FakePopupPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import { AttemptController } from "../attempt/AttemptController.js";
import type { AttemptCommand } from "../attempt/AttemptEffectPort.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import type { BrowserEnvironment } from "../environment/browserEnvironment.js";
import { BrowserPopup } from "../popup/BrowserPopup.js";
import { createRingLink } from "../shared/RingLink.js";
import { openSignInPopup } from "./openSignInPopup.js";
import { startAttempt } from "../../test/startAttempt.js";

const INSTANCE = {
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
};
const REQUEST = { instance: INSTANCE, attemptId: "popup-routing-attempt", generation: 0 };
const AUTH = "pubkyauth://" + ["private", "route", "material"].join("-") + "?caps=";
const ENVIRONMENT: BrowserEnvironment = {
  topLevel: true,
  protocol: "https:",
  storageWritable: true,
  inApp: false,
  iosStandalone: false,
  crossOriginIsolated: false,
};
const RESULTS = ["live", "null", "throw", "closed", "undefined"] as const;
type NativeResult = (typeof RESULTS)[number];
const resources: {
  popup: BrowserPopup;
  controller: AttemptController;
  clock: FakeClock;
  windows: FakePopupWindow[];
}[] = [];
afterEach(() => {
  for (const h of resources.splice(0)) {
    h.controller.dispose();
    h.popup.dispose();
    h.clock.assertEmpty();
    for (const fake of h.windows) fake.assertHealthy();
  }
});

function setup(first: NativeResult, retry: NativeResult = "live") {
  const clock = new FakeClock();
  const live = new FakePopupWindow();
  live.documentAllowed = true;
  const closed = new FakePopupWindow();
  closed.closed = true;
  const results = [first, retry];
  const commands: AttemptCommand[] = [];
  const commandsAtOpen: string[][] = [];
  const open = vi.fn<(...args: string[]) => Window | null | undefined>(() => {
    commandsAtOpen.push(commands.map((command) => command.type));
    const value = results.shift();
    if (value === "throw") throw new Error(AUTH);
    if (value === "closed") return closed.window;
    if (value === "live") return live.window;
    return value === "null" ? null : undefined;
  });
  const popup = new BrowserPopup(() => window, open, clock);
  const context = {
    defaultInstance: INSTANCE,
    attemptId: REQUEST.attemptId,
    now: 0,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: resolveClientOptions({}, (value) => value).timeouts,
  };
  const diagnostics = vi.fn();
  const controller = new AttemptController(
    INSTANCE,
    () => context,
    {
      run: (command) => {
        commands.push(command);
        // No profile: an optional-profile sign-in finishes without one.
        if (command.type === "CheckProfile")
          queueMicrotask(() =>
            controller.dispatch({ type: "PROFILE_MISSING", sessionId: command.sessionId }),
          );
      },
      dispose: () => {},
    },
    diagnostics,
    clock,
  );
  resources.push({ popup, controller, clock, windows: [live, closed] });
  const created = () =>
    controller.dispatch({ type: "FLOW_CREATED", flowId: 1, ringLink: createRingLink(() => AUTH) });
  return { popup, open, live, controller, context, commands, commandsAtOpen, diagnostics, created };
}

const matrix = RESULTS.flatMap((first) =>
  RESULTS.flatMap((retry) => [true, false].map((topLevel) => ({ first, retry, topLevel }))),
);
test.each(matrix)("$first then $retry, topLevel=$topLevel", async ({ first, retry, topLevel }) => {
  const h = setup(first, retry);
  const result = openSignInPopup(h.popup, REQUEST, { ...ENVIRONMENT, topLevel });
  const count = first === "undefined" ? 2 : 1;
  expect(h.open).toHaveBeenCalledTimes(count);
  expect(h.commandsAtOpen).toEqual(Array.from({ length: count }, () => []));
  expect(h.open.mock.calls[0]).toEqual([
    "about:blank",
    `pubky-passport-${REQUEST.attemptId}`,
    expect.stringMatching(/^popup,width=520,height=/u),
  ]);
  if (count === 2)
    expect(h.open.mock.calls[1]).toEqual([
      h.open.mock.calls[0]![0],
      "_blank",
      h.open.mock.calls[0]![2],
    ]);
  const promise = startAttempt(h.controller, result.event);
  const live = first === "live" || (first === "undefined" && retry === "live");
  if (live || first === "undefined") {
    expect("popup" in result.event).toBe(true);
    if ("popup" in result.event) expect(result.event.popup).toBe(live ? h.live.window : undefined);
    expect(h.controller.getState().status).toBe("opening");
    expect(h.commands.filter((command) => command.type === "CreateFlow")).toEqual([
      { type: "CreateFlow", flowId: 1, instance: INSTANCE },
    ]);
    h.created();
    expect(h.controller.getState().status).toBe(live ? "opening" : "detached");
    if (!live) {
      expect(h.controller.getState()).toMatchObject({ reason: "unreachable" });
      expect(h.commands.map((command) => command.type)).toEqual(["CreateFlow", "StartPolling"]);
      expect(h.diagnostics).not.toHaveBeenCalled();
    }
  } else if (!topLevel) {
    expect(await promise).toMatchObject({
      status: "failed",
      error: { code: "unsupported_environment" },
    });
    expect(h.commands.some((command) => command.type === "CreateFlow")).toBe(false);
  } else {
    // A blocked pop-up continues in this tab.
    expect(h.controller.getState().status).toBe("redirecting");
    expect(h.commands).toEqual([
      { type: "CreateFlow", flowId: 1, instance: INSTANCE, returnTo: REQUEST.attemptId },
    ]);
  }
  expect(result.diagnostic).toBeUndefined();
  h.controller.cancel();
  await promise;
});

test("a prepared flow keeps the same fragment on retry and its Session signs in from detached", async () => {
  const h = setup("undefined", "null");
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  h.created();
  h.commands.length = 0;
  const result = openSignInPopup(h.popup, { ...REQUEST, authorizationUrl: AUTH }, ENVIRONMENT);
  const promise = startAttempt(h.controller, result.event);
  expect(h.controller.getState()).toMatchObject({ status: "detached", reason: "unreachable" });
  expect(h.open.mock.calls.map(([url]) => url)).toEqual(
    Array(2).fill(INSTANCE.origin + "/authorize#d=" + encodeURIComponent(AUTH)),
  );
  expect(h.commands).toEqual([]);
  const session = new FakeSession();
  try {
    h.controller.receiveSession(1, session.session, {
      publicKey: "approved-key",
      capabilities: [],
      capabilitiesMatch: true,
    });
    const signedIn = await promise;
    expect(signedIn.status).toBe("signed-in");
    if (signedIn.status === "signed-in") expect(signedIn.session).toBe(session.session);
    expect(session.signouts).toBe(0);
  } finally {
    session.session.free();
    session.assertFreed();
  }
});

test.each([
  { ...ENVIRONMENT, inApp: true },
  { ...ENVIRONMENT, iosStandalone: true },
  { ...ENVIRONMENT, crossOriginIsolated: true },
])("a preferred same-tab route bypasses native opening (%o)", (environment) => {
  const h = setup("live");
  const result = openSignInPopup(h.popup, REQUEST, { ...environment, userActivation: false });
  expect(h.open).not.toHaveBeenCalled();
  expect(result.event).toMatchObject({
    type: "SIGN_IN",
    route: { kind: "redirect", cause: "preferred" },
    instance: INSTANCE,
  });
  expect(result.diagnostic).toBeUndefined();
});

test.each([
  [
    { ...ENVIRONMENT, topLevel: false },
    { kind: "failed", code: "unsupported_environment" },
  ],
  [
    { ...ENVIRONMENT, storageWritable: false },
    { kind: "failed", code: "popup_blocked", diagnostic: "redirect_unavailable" },
  ],
  [
    { ...ENVIRONMENT, protocol: "http:" },
    { kind: "failed", code: "popup_blocked" },
  ],
])("a blocked pop-up without a same-tab route fails (%o)", (environment, route) => {
  const h = setup("null");
  const result = openSignInPopup(h.popup, REQUEST, environment);
  expect(h.open).toHaveBeenCalledOnce();
  expect(result.event).toMatchObject({ type: "SIGN_IN", route, instance: INSTANCE });
});

test.each([false, true])(
  "unavailable redirect storage cannot affect an undefined retry (topLevel=%s)",
  (topLevel) => {
    const h = setup("undefined", "throw");
    const result = openSignInPopup(h.popup, REQUEST, {
      ...ENVIRONMENT,
      protocol: "http:",
      storageWritable: false,
      topLevel,
      userActivation: false,
    });
    expect(result.event).toEqual({ type: "SIGN_IN", instance: INSTANCE, popup: undefined });
    expect(result.diagnostic).toEqual({ code: "no_user_activation", attemptId: REQUEST.attemptId });
  },
);
