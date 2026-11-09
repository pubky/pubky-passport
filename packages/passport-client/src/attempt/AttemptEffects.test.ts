import { afterEach, expect, test, vi } from "vitest";
import type { ProfileRead } from "../profile/PassportProfile.js";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakePopupWindow } from "../../test/FakePopupPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { PassportError } from "../errors/PassportError.js";
import type { FlowCallbacks, FlowHandle, FlowResult } from "../flow/FlowPort.js";
import { FlowRegistry } from "../flow/FlowRegistry.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { BrowserPopup } from "../popup/BrowserPopup.js";
import { AttemptController } from "./AttemptController.js";
import { AttemptEffects } from "./AttemptEffects.js";
import type { AttemptEvent } from "./attemptModel.js";
import { startAttempt } from "../../test/startAttempt.js";
import { EMPTY_POLL_MS } from "../flow/FlowRunner.js";

const DEFAULT: PassportInstance = {
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
};
const CUSTOM: PassportInstance = {
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
};
const CANARY = ["effects", "private", "payload"].join("-");
const PROFILE = { name: "Approved" };
const resources: { finish(): Promise<void> }[] = [];
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

afterEach(async () => {
  try {
    for (const h of resources.splice(0)) await h.finish();
  } finally {
    vi.restoreAllMocks();
  }
});

function setup(requireProfile = false, keychainOffered?: () => boolean) {
  const clock = new FakeClock();
  let snapshot = 0;
  const context = {
    defaultInstance: DEFAULT,
    now: 0,
    leases: 0,
    visible: true,
    profile: requireProfile ? ("required" as const) : ("optional" as const),
    timeouts: resolveClientOptions({}, (v) => v).timeouts,
  };
  const profileChecks: {
    publicKey: string;
    settle(result: "found" | "missing" | "error"): void;
  }[] = [];
  // Required-profile harnesses settle each read by hand; optional ones find no profile.
  const readProfile = vi.fn(
    (publicKey: string) =>
      new Promise<ProfileRead>((resolve) => {
        const settle = (result: "found" | "missing" | "error") =>
          resolve(result === "found" ? { kind: "found", profile: PROFILE } : { kind: result });
        profileChecks.push({ publicKey, settle });
        if (!requireProfile) settle("missing");
      }),
  );
  const requests: {
    flow: FakeFlowPort;
    instance: PassportInstance;
    callbacks: FlowCallbacks | undefined;
    resolve(): void;
  }[] = [];
  const windows: FakePopupWindow[] = [];
  const sessions: FakeSession[] = [];
  const events: AttemptEvent[] = [];
  const snapshots: string[] = [];
  const diagnostic = vi.fn();
  const received = vi.fn();
  const redirect = vi.fn();
  const appWindow = vi.fn(() => window);
  const open = vi.fn(() => {
    throw new Error("Effects must never open a window");
  });
  const popup = new BrowserPopup(appWindow, open, clock);
  const flows = new FlowRegistry(
    (instance) => ({
      start(callbacks?: FlowCallbacks) {
        let resolve!: (value: FlowResult<FlowHandle>) => void;
        const pending = new Promise<FlowResult<FlowHandle>>((settle) => {
          resolve = settle;
        });
        const flow = new FakeFlowPort(`pubkyauth://${CANARY}-${requests.length}`);
        requests.push({
          flow,
          instance,
          callbacks,
          resolve: () => resolve({ ok: true, value: flow }),
        });
        return pending;
      },
      resume() {
        throw new Error("Redirect runtime owns resume");
      },
    }),
    {
      event: (event) => controller.dispatch(event),
      // Known fixture metadata: the controller claims the raw Session before using it.
      session: (id, session) =>
        controller.receiveSession(id, session, {
          publicKey: "approved-key",
          capabilities: [],
          capabilitiesMatch: true,
        }),
      diagnostic,
    },
    clock,
  );
  const effects = new AttemptEffects({
    flows,
    popup,
    profile: requireProfile ? "required" : "optional",
    ...(keychainOffered ? { keychainOffered } : {}),
    readProfile,
    appWindow,
    clock,
    redirect,
    returnCallbacks: (attemptId) => ({
      xSuccess: `https://app.example/?pubky-passport=s.${attemptId}`,
      xError: `https://app.example/?pubky-passport=e.${attemptId}`,
      xCancel: `https://app.example/?pubky-passport=c.${attemptId}`,
    }),
    diagnostic,
    event: (event) => {
      events.push(event);
      controller.dispatch(event);
    },
    failed: (cause) =>
      controller.dispatch({
        type: "RUNTIME_FAILED",
        error: new PassportError("internal", { cause }),
      }),
  });
  const controller = new AttemptController(
    DEFAULT,
    () => ({ ...context, now: clock.now(), attemptId: `effects-attempt-${++snapshot}` }),
    effects,
    diagnostic,
    clock,
  );
  controller.onSession(received);
  let lastAttemptId: string | undefined;
  controller.subscribe((state) => {
    if ("attemptId" in state) lastAttemptId = state.attemptId;
    snapshots.push(JSON.stringify(state));
  });
  const makeWindow = () => {
    const w = new FakePopupWindow();
    windows.push(w);
    return w;
  };
  const start = (instance = DEFAULT, w = makeWindow()) => ({
    w,
    promise: startAttempt(controller, { type: "SIGN_IN", instance, popup: w.window }),
  });
  const created = async (index = 0) => {
    requests[index]!.resolve();
    await flush();
  };
  const approve = async (index = 0) => {
    const session = new FakeSession();
    sessions.push(session);
    requests[index]!.flow.settle(session.session);
    await flush();
    return session;
  };
  const message = (
    data: unknown,
    source = windows.at(-1)!,
    origin = controller.getState().instance.origin,
  ) => {
    const event = new MessageEvent("message", { data, origin });
    Object.defineProperty(event, "source", { value: source.window });
    window.dispatchEvent(event);
  };
  const attemptId = () => {
    if (!lastAttemptId) throw new Error("No test attempt exists");
    return lastAttemptId;
  };
  const ready = (status = "valid", source = windows.at(-1)!, origin?: string) =>
    message(
      {
        type: "pubky-passport.ready",
        version: 2,
        attemptId: attemptId(),
        protocols: [1, 2],
        features: [],
        request: { status },
      },
      source,
      origin,
    );
  const outcome = (outcome = "success", messageId = "first-outcome") =>
    message({
      type: "pubky-passport.authorization-outcome",
      version: 2,
      attemptId: attemptId(),
      messageId,
      outcome,
    });
  const finish = async () => {
    controller.dispose();
    for (const check of profileChecks) check.settle("missing");
    for (const request of requests) request.resolve();
    await flush();
    for (const { flow } of requests) if (flow.pending) flow.settle();
    await flush();
    for (const { flow } of requests) flow.assertFreed();
    for (const w of windows) w.assertHealthy();
    for (const session of sessions) session.assertFreed();
    clock.assertEmpty();
    expect(open).not.toHaveBeenCalled();
    expect(
      JSON.stringify([snapshots, events, diagnostic.mock.calls, windows.map((w) => w.posts)]),
    ).not.toContain(CANARY);
  };
  const h = {
    clock,
    profileChecks,
    readProfile,
    context,
    attemptId,
    requests,
    windows,
    events,
    snapshots,
    diagnostic,
    received,
    redirect,
    appWindow,
    popup,
    flows,
    effects,
    controller,
    makeWindow,
    start,
    created,
    approve,
    message,
    ready,
    outcome,
    finish,
  };
  resources.push(h);
  return h;
}

test("constructs without browser access; commands never open a window", () => {
  const h = setup();
  expect(h.appWindow).not.toHaveBeenCalled();
  expect(h.requests).toHaveLength(0);
});

test("required hello and Session hold with missing/error/found reads keep the result and app event private", async () => {
  const h = setup(true);
  const { w, promise } = h.start(CUSTOM);
  const settled = vi.fn();
  void promise.then(settled);
  await h.created();
  expect(w.posts[0]).toMatchObject({ message: { profile: "required" } });
  h.ready();
  const session = await h.approve();
  expect(h.controller.getState()).toMatchObject({ status: "finishing", via: "popup" });
  expect(h.profileChecks).toHaveLength(1);
  expect(h.profileChecks[0]!.publicKey).toBe("approved-key");
  expect(h.received).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
  expect(session.signouts).toBe(0);
  expect(session.frees).toBe(0);
  // Passport's window stays open while the profile is read: it might be asked to create it.
  expect(w.closed).toBe(false);
  h.profileChecks[0]!.settle("missing");
  await flush();
  // This Passport did not offer profile setup, so its window closes as before.
  expect(w.closed).toBe(true);
  const posts = w.posts.length;
  expect(h.controller.getState()).toMatchObject({ status: "needs-profile", check: "missing" });
  expect(h.controller.getState()).not.toHaveProperty("passport");
  h.clock.advance(4999);
  expect(h.profileChecks).toHaveLength(1);
  h.clock.advance(1);
  expect(h.profileChecks).toHaveLength(2);
  h.controller.dispatch({ type: "FOCUS" });
  h.controller.dispatch({ type: "DOCUMENT_VISIBLE" });
  h.clock.advance(5000);
  expect(h.profileChecks).toHaveLength(2);
  h.profileChecks[1]!.settle("error");
  await flush();
  expect(h.controller.getState()).toMatchObject({ status: "needs-profile", check: "error" });
  expect(h.diagnostic).toHaveBeenCalledWith({
    code: "profile_check_failed",
    attemptId: h.attemptId(),
  });
  h.controller.dispatch({ type: "FOCUS" });
  expect(h.profileChecks).toHaveLength(3);
  expect(h.received).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
  h.profileChecks[2]!.settle("found");
  await flush();
  expect(await promise).toMatchObject({
    status: "signed-in",
    session: session.session,
    info: { publicKey: "approved-key" },
  });
  expect(h.received).toHaveBeenCalledOnce();
  expect(w.posts).toHaveLength(posts);
  expect(session.signouts).toBe(0);
  h.clock.assertEmpty();
  session.session.free();
});

test.each(["cancel", "dispose", "timeout"] as const)(
  "%s revokes a held Session and ignores the pending read's eventual success",
  async (method) => {
    const h = setup(true);
    const { promise } = h.start();
    await h.created();
    const session = await h.approve();
    if (method === "timeout") h.clock.advance(h.context.timeouts.attemptMs);
    else h.controller[method]();
    expect(await promise).toMatchObject({
      status: "failed",
      error: { code: method === "timeout" ? "timeout" : "cancelled" },
    });
    await flush();
    expect(session.signouts).toBe(1);
    expect(session.frees).toBe(1);
    const before = h.controller.getState();
    h.profileChecks[0]!.settle("found");
    await flush();
    expect(h.controller.getState()).toBe(before);
    expect(h.received).not.toHaveBeenCalled();
    expect(h.events.some((e) => e.type === "PROFILE_FOUND")).toBe(false);
    h.clock.assertEmpty();
  },
);

test("missing-profile retries do not extend the deadline or release a held Session", async () => {
  const h = setup(true);
  const { promise } = h.start();
  await h.created();
  const session = await h.approve();
  h.profileChecks[0]!.settle("missing");
  await flush();
  h.clock.advance(h.context.timeouts.attemptMs - 1);
  h.profileChecks[1]!.settle("missing");
  await flush();
  expect(h.received).not.toHaveBeenCalled();
  expect(session.signouts).toBe(0);
  h.clock.advance(1);
  expect(await promise).toMatchObject({ status: "failed", error: { code: "profile_required" } });
  await flush();
  expect(session.signouts).toBe(1);
  expect(session.frees).toBe(1);
  h.clock.assertEmpty();
});

test.each(["cancel", "dispose"] as const)(
  "%s while missing revokes the Session and rejects either late read result",
  async (method) => {
    for (const result of ["found", "error"] as const) {
      const h = setup(true);
      const { promise } = h.start();
      await h.created();
      const session = await h.approve();
      h.profileChecks[0]!.settle("missing");
      await flush();
      h.controller.dispatch({ type: "FOCUS" });
      expect(h.profileChecks).toHaveLength(2);
      h.controller[method]();
      expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
      const events = h.events.length;
      h.profileChecks[1]!.settle(result);
      await flush();
      expect(h.events).toHaveLength(events);
      expect(h.received).not.toHaveBeenCalled();
      expect(session.signouts).toBe(1);
      session.assertFreed();
      h.clock.assertEmpty();
    }
  },
);

test("hidden recheck waits for visibility, with focus sharing the same in-flight check", async () => {
  const h = setup(true);
  const { promise } = h.start();
  await h.created();
  const session = await h.approve();
  h.profileChecks[0]!.settle("missing");
  await flush();
  h.context.visible = false;
  h.clock.advance(10000);
  expect(h.profileChecks).toHaveLength(1);
  h.context.visible = true;
  h.controller.dispatch({ type: "DOCUMENT_VISIBLE" });
  h.controller.dispatch({ type: "FOCUS" });
  expect(h.profileChecks).toHaveLength(2);
  h.profileChecks[1]!.settle("found");
  expect((await promise).status).toBe("signed-in");
  session.session.free();
});

test("an old read cannot report into, or clear the token for, a newer attempt", async () => {
  const h = setup(true);
  const first = h.start();
  await h.created();
  await h.approve();
  h.controller.cancel();
  await first.promise;
  const second = h.start();
  await h.created(1);
  const winner = await h.approve(1);
  h.profileChecks[0]!.settle("found");
  await flush();
  expect(h.controller.getState().status).toBe("finishing");
  expect(h.received).not.toHaveBeenCalled();
  expect(h.events.some((e) => e.type === "PROFILE_FOUND")).toBe(false);
  h.effects.run({ type: "CheckProfile", sessionId: 2, publicKey: "approved-key" });
  expect(h.profileChecks).toHaveLength(2);
  h.profileChecks[1]!.settle("found");
  expect((await second.promise).status).toBe("signed-in");
  expect(h.received).toHaveBeenCalledExactlyOnceWith(winner.session, expect.anything());
  winner.session.free();
});

test.each(["throw", "reject"] as const)(
  "an injected profile %s enters retry state without raw cause",
  async (mode) => {
    const h = setup(true);
    if (mode === "throw")
      h.readProfile.mockImplementationOnce(() => {
        throw new Error(CANARY);
      });
    else h.readProfile.mockRejectedValueOnce(new Error(CANARY));
    const { promise } = h.start();
    await h.created();
    const session = await h.approve();
    expect(h.controller.getState()).toMatchObject({ status: "needs-profile", check: "error" });
    expect(h.received).not.toHaveBeenCalled();
    expect(session.signouts).toBe(0);
    h.controller.cancel();
    expect((await promise).status).toBe("failed");
  },
);

test("a duplicate Session while held is revoked without replacing the winner", async () => {
  const h = setup(true);
  const { promise } = h.start();
  await h.created();
  const winner = await h.approve();
  const duplicate = new FakeSession();
  h.controller.receiveSession(1, duplicate.session, {
    publicKey: "other-key",
    capabilities: [],
    capabilitiesMatch: false,
  });
  await flush();
  expect(duplicate.signouts).toBe(1);
  duplicate.assertFreed();
  expect(h.profileChecks).toHaveLength(1);
  h.profileChecks[0]!.settle("found");
  expect((await promise).status).toBe("signed-in");
  expect(h.received).toHaveBeenCalledExactlyOnceWith(
    winner.session,
    expect.objectContaining({ publicKey: "approved-key" }),
  );
  winner.session.free();
});

test("profile event dispatch failure ends the hold through the sanitized failure boundary", async () => {
  const h = setup(true);
  const { promise } = h.start();
  await h.created();
  const session = await h.approve();
  vi.spyOn(h.controller, "dispatch").mockImplementationOnce(() => {
    throw new Error(CANARY);
  });
  h.profileChecks[0]!.settle("found");
  await flush();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(h.received).not.toHaveBeenCalled();
  expect(session.signouts).toBe(1);
  session.assertFreed();
});

test("synchronous cancellation inside the profile dependency invalidates its read token", async () => {
  const h = setup(true);
  h.readProfile.mockImplementationOnce(async () => {
    h.controller.cancel();
    return { kind: "found", profile: PROFILE };
  });
  const { promise } = h.start();
  await h.created();
  const session = await h.approve();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(h.received).not.toHaveBeenCalled();
  expect(h.events.some((event) => event.type === "PROFILE_FOUND")).toBe(false);
  expect(session.signouts).toBe(1);
  session.assertFreed();
});

test("a late held Session only delivers the event after the original signIn already failed", async () => {
  const h = setup(true);
  const { promise } = h.start();
  await h.created();
  h.clock.advance(h.context.timeouts.attemptMs);
  const settled = await promise;
  expect(settled).toMatchObject({ status: "failed", error: { code: "timeout" } });
  const session = await h.approve();
  expect(h.controller.getState().status).toBe("finishing");
  expect(h.received).not.toHaveBeenCalled();
  h.profileChecks[0]!.settle("found");
  await flush();
  expect(await promise).toBe(settled);
  expect(h.received).toHaveBeenCalledExactlyOnceWith(session.session, expect.anything());
  session.session.free();
});

test.each(["s", "c", "e", "none"] as const)(
  "return marker %s gets a bounded initial profile check and ignores its late success (A34)",
  async (marker) => {
    const h = setup(true);
    const promise = h.controller.reserveResult();
    h.controller.dispatch({
      type: "RETURN_DETECTED",
      valid: true,
      marker,
      instance: CUSTOM,
      attemptId: "returned",
    });
    const flowId = h.controller.snapshot().flow!;
    h.controller.dispatch({ type: "RESUMED", flowId });
    const session = new FakeSession();
    h.controller.receiveSession(flowId, session.session, {
      publicKey: "approved-key",
      capabilities: [],
      capabilitiesMatch: true,
    });
    h.clock.advance(h.context.timeouts.attemptMs - 1);
    expect(h.controller.getState()).toMatchObject({ status: "finishing", via: "redirect" });
    expect(h.received).not.toHaveBeenCalled();
    h.clock.advance(1);
    expect(await promise).toMatchObject({ status: "failed", error: { code: "timeout" } });
    h.profileChecks[0]!.settle("found");
    await flush();
    expect(session.signouts).toBe(1);
    session.assertFreed();
    expect(h.received).not.toHaveBeenCalled();
    expect(h.events.some((event) => event.type === "PROFILE_FOUND")).toBe(false);
    h.clock.assertEmpty();
  },
);

test("names the app's own keychain route in each hello only while the app offers one", async () => {
  let offered = true;
  const keychainOffered = vi.fn(() => offered);
  const h = setup(false, keychainOffered);
  const { w } = h.start();
  await h.created();
  expect(w.posts[0]).toMatchObject({
    message: { type: "pubky-passport.hello", features: ["outcome-v2", "status", "keychain"] },
  });
  offered = false;
  h.clock.advance(250);
  expect(w.posts.at(-1)).toMatchObject({
    message: { type: "pubky-passport.hello", features: ["outcome-v2", "status"] },
  });
  expect(keychainOffered).toHaveBeenCalledTimes(w.posts.length);

  // Without the option, no hello names it.
  const plain = setup();
  const { w: other } = plain.start();
  await plain.created();
  expect(other.posts[0]).toMatchObject({
    message: { type: "pubky-passport.hello", features: ["outcome-v2", "status"] },
  });
});

test("a pinned flow navigates once, confirms, acknowledges, then only its Session signs in", async () => {
  const h = setup();
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const { w, promise } = h.start(CUSTOM);
  const settled = vi.fn();
  void promise.then(settled);
  await h.created();
  expect(w.navigations).toEqual([
    `${CUSTOM.origin}/authorize#d=${encodeURIComponent(h.requests[0]!.flow.url)}`,
  ]);
  expect(w.posts[0]).toMatchObject({
    origin: CUSTOM.origin,
    message: { type: "pubky-passport.hello", profile: "optional" },
  });
  h.ready();
  expect(h.controller.getState()).toMatchObject({ status: "waiting", handshake: "confirmed" });
  h.clock.advance(2000);
  expect(w.posts).toHaveLength(2);
  h.outcome();
  expect(w.posts.at(-1)).toMatchObject({
    origin: CUSTOM.origin,
    message: {
      type: "pubky-passport.authorization-outcome-ack",
      version: 2,
      attemptId: h.attemptId(),
    },
  });
  expect(h.controller.getState().status).toBe("finishing");
  await flush();
  expect(settled).not.toHaveBeenCalled();
  const posts = w.posts.length;
  h.clock.advance(2000);
  expect(w.posts).toHaveLength(posts);
  const session = await h.approve();
  expect(await promise).toMatchObject({
    status: "signed-in",
    session: session.session,
    info: { publicKey: "approved-key" },
  });
  expect(h.received).toHaveBeenCalledOnce();
  expect(w.closeCalls).toBe(1);
  expect(h.redirect).toHaveBeenCalledExactlyOnceWith({ type: "DeleteRedirectState" });
  const listeners = add.mock.calls.filter(([type]) => type === "message");
  expect(listeners).toHaveLength(1);
  expect(remove).toHaveBeenCalledWith("message", listeners[0]![1]);
  expect(h.requests[0]!.flow.frees).toBe(1);
  h.clock.assertEmpty();
  session.session.free();
});

test("an unconfirmed success stops hello and later outcomes only acknowledge", async () => {
  const h = setup();
  const { w, promise } = h.start();
  await h.created();
  h.clock.advance(h.context.timeouts.handshakeHintMs);
  expect(h.controller.getState()).toMatchObject({ handshake: "unconfirmed" });
  h.outcome();
  h.outcome("cancel", "different-outcome");
  expect(h.controller.getState().status).toBe("finishing");
  const posts = w.posts.length;
  h.clock.advance(2000);
  expect(w.posts).toHaveLength(posts);
  const session = await h.approve();
  await promise;
  session.session.free();
});

test("Reopen replaces the source, keeps one listener, and ignores stale close callbacks", async () => {
  const h = setup();
  const watch = vi.spyOn(h.popup, "watch");
  const add = vi.spyOn(window, "addEventListener");
  const { w, promise } = h.start();
  await h.created();
  h.ready();
  h.ready("empty");
  expect(h.controller.getState().status).toBe("detached");
  const replacement = h.makeWindow();
  h.controller.dispatch({ type: "REOPEN", popup: replacement.window });
  expect(w.closeCalls).toBe(1);
  watch.mock.calls[0]![1]();
  h.ready("expired", w);
  expect(h.controller.getState().status).toBe("opening");
  h.ready();
  expect(h.controller.getState()).toMatchObject({ status: "waiting", window: "open" });
  expect(add.mock.calls.filter(([type]) => type === "message")).toHaveLength(1);
  expect(h.requests).toHaveLength(1);
  const session = await h.approve();
  await promise;
  session.session.free();
});

test("Use default unbinds the abandoned window before fresh creation and isolates both secrets", async () => {
  const h = setup();
  const { w, promise } = h.start(CUSTOM);
  await h.created();
  h.ready();
  const replacement = h.makeWindow();
  h.controller.dispatch({ type: "USE_DEFAULT_INSTANCE", popup: replacement.window });
  h.ready("expired", w, CUSTOM.origin);
  expect(h.controller.getState()).toMatchObject({ status: "opening", instance: DEFAULT });
  expect(replacement.navigations).toEqual([]);
  await h.created(1);
  expect(w.navigations).toEqual([
    `${CUSTOM.origin}/authorize#d=${encodeURIComponent(h.requests[0]!.flow.url)}`,
  ]);
  expect(replacement.navigations).toEqual([
    `${DEFAULT.origin}/authorize#d=${encodeURIComponent(h.requests[1]!.flow.url)}`,
  ]);
  expect(replacement.navigations[0]).not.toContain(encodeURIComponent(h.requests[0]!.flow.url));
  h.ready();
  const abandoned = await h.approve(0);
  expect(abandoned.signouts).toBe(1);
  const winner = await h.approve(1);
  expect((await promise).status).toBe("signed-in");
  winner.session.free();
});

test("cancelling pending creation closes its window and frees the orphan without navigation", async () => {
  const h = setup();
  const { w, promise } = h.start();
  h.controller.cancel();
  await h.created();
  expect(await promise).toMatchObject({
    status: "failed",
    error: { code: "cancelled", detail: { by: "app" } },
  });
  expect(w.navigations).toEqual([]);
  expect(w.posts).toEqual([]);
  expect(w.closeCalls).toBe(1);
  expect(h.requests[0]!.flow.polls).toBe(0);
});

test.each(["cancel", "dispose"] as const)(
  "%s cleans browser resources but still revokes a late raw Session",
  async (method) => {
    const h = setup();
    const { w, promise } = h.start();
    await h.created();
    h.controller[method]();
    await promise;
    const posts = w.posts.length;
    h.ready();
    h.clock.advance(2000);
    expect(w.posts).toHaveLength(posts);
    const late = await h.approve();
    expect(late.signouts).toBe(1);
    expect(h.received).not.toHaveBeenCalled();
    expect(h.diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ code: "late_session_revoked" }),
    );
  },
);

test("a watched user close fails after grace and a passive late Session still arrives by event", async () => {
  const h = setup();
  const { w, promise } = h.start();
  await h.created();
  h.ready();
  w.closed = true;
  h.clock.advance(500);
  expect(h.controller.getState()).toMatchObject({ status: "waiting", window: "closed" });
  h.clock.advance(h.context.timeouts.closedGraceMs);
  expect(await promise).toMatchObject({ status: "failed", error: { code: "popup_closed" } });
  const late = await h.approve();
  expect(h.received).toHaveBeenCalledOnce();
  expect(late.signouts).toBe(0);
  late.session.free();
});

test("a lease adopts the already polling flow and retirement continues after the attempt ends", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await h.created();
  h.context.leases = 0;
  const { w, promise } = h.start();
  expect(w.navigations).toEqual([]); // The synchronous facade opens the prepared final URL.
  expect(h.requests).toHaveLength(1);
  expect(h.requests[0]!.flow.polls).toBe(1);
  h.clock.advance(h.context.timeouts.attemptMs);
  await promise;
  h.requests[0]!.flow.settle();
  await flush();
  h.clock.advance(EMPTY_POLL_MS);
  expect(h.requests[0]!.flow.polls).toBe(2);
  const session = await h.approve();
  expect(h.received).toHaveBeenCalledOnce();
  session.session.free();
});

test("focus and page leave use only the owned window, without starting another flow", async () => {
  const h = setup();
  const { w, promise } = h.start();
  await h.created();
  h.ready();
  h.controller.dispatch({ type: "FOCUS" });
  expect(w.focusCalls).toBe(1);
  h.controller.dispatch({ type: "PAGE_HIDE", persisted: true });
  expect(w.closeCalls).toBe(0);
  h.controller.dispatch({ type: "PAGE_HIDE", persisted: false });
  expect(w.closeCalls).toBe(1);
  expect(h.requests).toHaveLength(1);
  h.controller.cancel();
  await promise;
});

test("same-tab commands go to the redirect runtime without starting or polling a popup flow", () => {
  const h = setup();
  const commands = [
    { type: "SaveStateAndNavigate", flowId: 7 },
    { type: "ResumeFlow", flowId: 8 },
    { type: "DeleteRedirectState" },
  ] as const;
  for (const command of commands) h.effects.run(command);
  expect(h.redirect.mock.calls.map(([command]) => command)).toEqual(commands);
  expect(h.requests).toHaveLength(0);
  expect(h.appWindow).not.toHaveBeenCalled();
});

test("a same-tab flow is created with callbacks back to this page, for its own attempt", async () => {
  const h = setup();
  h.effects.run({ type: "CreateFlow", flowId: 7, instance: CUSTOM, returnTo: "R".repeat(22) });
  await flush();
  expect(h.requests).toHaveLength(1);
  expect(h.requests[0]!.callbacks).toEqual({
    xSuccess: `https://app.example/?pubky-passport=s.${"R".repeat(22)}`,
    xError: `https://app.example/?pubky-passport=e.${"R".repeat(22)}`,
    xCancel: `https://app.example/?pubky-passport=c.${"R".repeat(22)}`,
  });
  expect(h.redirect).not.toHaveBeenCalled();
});

test("a pop-up flow carries no callbacks: Passport answers it through the opener", async () => {
  const h = setup();
  const { promise } = h.start();
  await h.created();
  expect(h.requests[0]!.callbacks).toBeUndefined();
  h.controller.cancel();
  await promise;
});

test("native navigation failure is sanitized by the controller and all ownership cleanup still runs", async () => {
  const h = setup();
  const { w, promise } = h.start();
  w.failure = "replace";
  await h.created();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(w.closeCalls).toBe(1);
  expect(h.received).not.toHaveBeenCalled();
  h.clock.assertEmpty();
});

test("an asynchronous window-watch failure reaches the internal failure boundary", async () => {
  const h = setup();
  const { w, promise } = h.start();
  await h.created();
  h.ready();
  const schedule = vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error(CANARY);
  });
  h.clock.advance(500);
  schedule.mockRestore();
  const result = await promise;
  expect(result).toMatchObject({
    status: "failed",
    error: { code: "internal", cause: { name: "PassportErrorCause", message: "UnknownError" } },
  });
  expect(JSON.stringify(result)).not.toContain(CANARY);
  expect(w.closeCalls).toBe(1);
});

test("an asynchronous hello failure reaches the internal failure boundary", async () => {
  const h = setup();
  const { w, promise } = h.start();
  await h.created();
  const schedule = vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error(CANARY);
  });
  h.clock.advance(250);
  schedule.mockRestore();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(w.closeCalls).toBe(1);
});

test("synchronous closure during watch installation cannot retain its returned cleanup", async () => {
  const h = setup();
  const cancel = vi.fn();
  vi.spyOn(h.popup, "watch").mockImplementationOnce((_popup, closed) => {
    closed();
    return cancel;
  });
  const { w, promise } = h.start();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "popup_closed" } });
  expect(cancel).toHaveBeenCalledOnce();
  expect(w.closeCalls).toBe(1);
  await h.created();
  expect(h.requests[0]!.flow.reads).toBe(0);
});

test("watch cleanup is invalidated before reentrant callbacks and throwing cleanup cannot strand a channel", async () => {
  const h = setup();
  const nativeWatch = h.popup.watch.bind(h.popup);
  vi.spyOn(h.popup, "watch").mockImplementationOnce((popup, closed, failed) => {
    const cancel = nativeWatch(popup, closed, failed);
    return () => {
      cancel();
      closed();
      failed?.(new Error(CANARY));
      throw new Error(CANARY);
    };
  });
  const { w, promise } = h.start();
  await h.created();
  h.controller.cancel();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(h.events).toEqual([]);
  h.ready();
  expect(h.events).toEqual([]);
  expect(w.closeCalls).toBe(1);
  h.clock.assertEmpty();
});

test.each(["watch", "listener"])(
  "a %s installation failure releases partial browser ownership",
  async (operation) => {
    const h = setup();
    if (operation === "watch")
      vi.spyOn(h.popup, "watch").mockImplementationOnce(() => {
        throw new Error(CANARY);
      });
    else {
      const add = window.addEventListener.bind(window);
      vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
        add(type, listener, options);
        if (type === "message") throw new Error(CANARY);
      });
    }
    const { w, promise } = h.start();
    await h.created();
    expect(await promise).toMatchObject({ status: "failed", error: { code: "internal" } });
    h.ready();
    expect(h.events).toEqual([]);
    expect(w.closeCalls).toBe(1);
    h.clock.assertEmpty();
  },
);

test("a new attempt installs a new channel after all old resources end", async () => {
  const h = setup();
  const add = vi.spyOn(window, "addEventListener");
  const first = h.start();
  const firstId = h.attemptId();
  await h.created();
  h.outcome("cancel");
  await first.promise;
  const second = h.start();
  expect(h.attemptId()).not.toBe(firstId);
  await h.created(1);
  h.ready("expired", first.w);
  expect(h.controller.getState().status).toBe("opening");
  h.outcome();
  expect(h.controller.getState().status).toBe("finishing");
  expect(add.mock.calls.filter(([type]) => type === "message")).toHaveLength(2);
  const session = await h.approve(1);
  await second.promise;
  session.session.free();
});

test.each(["instance", "authorizationUrl"] as const)(
  "a missing flow %s cannot navigate to any destination",
  async (field) => {
    const h = setup();
    const { w, promise } = h.start();
    vi.spyOn(h.flows, field).mockReturnValue(undefined);
    await h.created();
    expect(await promise).toMatchObject({ status: "failed", error: { code: "internal" } });
    expect(w.navigations).toEqual([]);
  },
);

test.each([
  { instance: CUSTOM, destination: DEFAULT },
  { instance: DEFAULT, destination: CUSTOM },
])(
  "a $instance.host flow rejects a $destination.host navigation before URL access",
  async ({ instance, destination }) => {
    const h = setup();
    const { promise } = h.start(instance);
    await h.created();
    const replacement = h.makeWindow();
    const readUrl = vi.spyOn(h.flows, "authorizationUrl");
    expect(() =>
      h.effects.run({
        type: "NavigatePopup",
        flowId: 1,
        popup: replacement.window,
        origin: destination.origin,
      }),
    ).toThrow("Passport window navigation failed");
    expect(readUrl).not.toHaveBeenCalled();
    expect(replacement.navigations).toEqual([]);
    h.controller.cancel();
    await promise;
  },
);

test("a mismatched registry pin fails through the controller without accessing a private URL", async () => {
  const h = setup();
  const { w, promise } = h.start(CUSTOM);
  vi.spyOn(h.flows, "instance").mockReturnValue(DEFAULT);
  const readUrl = vi.spyOn(h.flows, "authorizationUrl");
  await h.created();
  expect(w.navigations).toEqual([]);
  expect(readUrl).not.toHaveBeenCalled();
  const result = await promise;
  expect(result).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(JSON.stringify(result)).not.toContain(CANARY);
  expect(w.closeCalls).toBe(1);
});
