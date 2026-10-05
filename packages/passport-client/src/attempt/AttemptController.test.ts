import { afterEach, expect, test, vi } from "vitest";
import { FakeSession } from "../../test/FakeSession.js";
import { FakeClock } from "../../test/FakeClock.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { PassportError } from "../errors/PassportError.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { createRingLink } from "../shared/RingLink.js";
import { AttemptController } from "./AttemptController.js";
import type { AttemptEffect, AttemptContext, AttemptEvent } from "./attemptModel.js";
import { startAttempt } from "../../test/startAttempt.js";

const INSTANCE = Object.freeze({
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
});
const CUSTOM = Object.freeze({
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
});
const WINDOW = Object.freeze({ name: "popup" }) as unknown as Window;
const CANARY = ["private", "flow", "material"].join("-");
const metadata = {
  publicKey: "approved-key",
  capabilities: ["/pub/example.app/:rw"],
  capabilitiesMatch: true,
};
const sessions: FakeSession[] = [];
const controllers: AttemptController[] = [];
const clocks: FakeClock[] = [];
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  await flush();
  for (const session of sessions.splice(0)) session.assertFreed();
  for (const clock of clocks.splice(0)) clock.assertEmpty();
});
function session() {
  const fake = new FakeSession();
  sessions.push(fake);
  return fake;
}
function setup(selection: PassportInstance = INSTANCE) {
  const clock = new FakeClock();
  clocks.push(clock);
  let id = 0;
  const context = {
    defaultInstance: INSTANCE,
    attemptId: "",
    now: 1000,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: resolveClientOptions({}, (value) => value).timeouts,
  } satisfies AttemptContext;
  const commands: AttemptEffect[] = [];
  const openWindows = new Set<Window>();
  const diagnostics = vi.fn();
  const port = {
    run: vi.fn((effect: AttemptEffect) => {
      commands.push(effect);
      if (effect.type === "WatchPopup") openWindows.add(effect.popup);
      if (effect.type === "ClosePopup") openWindows.delete(effect.popup);
      if (effect.type === "EndAttempt") openWindows.clear();
      // No profile: an optional-profile sign-in finishes without one.
      if (effect.type === "CheckProfile")
        controller.dispatch({ type: "PROFILE_MISSING", sessionId: effect.sessionId });
    }),
    dispose: vi.fn(),
  };
  const readContext = vi.fn(() => ({ ...context, now: clock.now(), attemptId: `attempt-${++id}` }));
  const controller = new AttemptController(selection, readContext, port, diagnostics, clock);
  controllers.push(controller);
  const start = (instance: PassportInstance = INSTANCE) =>
    startAttempt(controller, { type: "SIGN_IN", popup: WINDOW, instance });
  const created = (flowId = 1) =>
    controller.dispatch({ type: "FLOW_CREATED", flowId, ringLink: createRingLink(() => CANARY) });
  const receive = (fake: FakeSession, flowId = 1, matches = true) =>
    controller.receiveSession(flowId, fake.session, { ...metadata, capabilitiesMatch: matches });
  return {
    controller,
    commands,
    openWindows,
    context,
    readContext,
    port,
    diagnostics,
    start,
    created,
    receive,
    clock,
  };
}

test("a live start returns the same promise and creates one flow", async () => {
  const h = setup();
  const first = h.start();
  expect(h.start()).toBe(first);
  expect(h.commands.filter((e) => e.type === "CreateFlow")).toHaveLength(1);
  h.controller.cancel();
  expect(await first).toMatchObject({
    status: "failed",
    error: { code: "cancelled", detail: { by: "app" } },
  });
});

test("an outcome never authenticates; a Session transfers once after popup cleanup", async () => {
  const h = setup();
  const done = vi.fn();
  const promise = h.start();
  void promise.then(done);
  h.created();
  h.controller.dispatch({ type: "OUTCOME", outcome: "success", messageId: "one", version: 2 });
  await flush();
  expect(done).not.toHaveBeenCalled();
  expect(h.controller.getState().status).toBe("finishing");
  const fake = session();
  let lastCommand: AttemptEffect | undefined;
  let closedBeforeDelivery = false;
  const delivered = vi.fn(() => {
    lastCommand = h.commands.at(-1);
    closedBeforeDelivery = !h.openWindows.has(WINDOW);
  });
  h.controller.onSession(delivered);
  h.receive(fake);
  expect(await promise).toMatchObject({
    status: "signed-in",
    session: fake.session,
    info: { publicKey: metadata.publicKey, profile: null },
  });
  expect(lastCommand).toMatchObject({ type: "EndAttempt" });
  expect(closedBeforeDelivery).toBe(true);
  // The app gets the key and the profile; nothing about the route the Session came by.
  expect(delivered).toHaveBeenCalledExactlyOnceWith(fake.session, {
    publicKey: metadata.publicKey,
    profile: null,
  });
  h.receive(fake);
  expect(delivered).toHaveBeenCalledTimes(1);
  expect(fake.signouts).toBe(0);
  fake.session.free();
});

test.each(["ATTEMPT_TIMEOUT", "CLOSED_GRACE"] as const)(
  "a Session after %s emits without resolving the old promise again",
  async (event) => {
    const h = setup();
    const settled = vi.fn();
    const promise = h.start();
    void promise.then(settled);
    h.created();
    h.controller.dispatch({ type: "READY", status: "valid" });
    if (event === "CLOSED_GRACE") h.controller.dispatch({ type: "POPUP_CLOSED" });
    h.controller.dispatch({ type: event });
    expect((await promise).status).toBe("failed");
    const observer = vi.fn();
    h.controller.onSession(observer);
    const fake = session();
    h.receive(fake);
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledOnce();
    expect(h.controller.getState().status).toBe("signed-in");
    fake.session.free();
  },
);

test.each(["cancel", "dispose"] as const)(
  "%s excludes a late Session from app ownership",
  async (method) => {
    const h = setup();
    const promise = h.start();
    h.created();
    const observer = vi.fn();
    h.controller.onSession(observer);
    h.controller[method]();
    expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
    const fake = session();
    h.receive(fake);
    await flush();
    expect(observer).not.toHaveBeenCalled();
    expect(fake.signouts).toBe(1);
    expect(h.diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ code: "late_session_revoked" }),
    );
  },
);

test("duplicate and mismatched Sessions are revoked without exposing handles", async () => {
  const h = setup();
  const first = h.start();
  h.created();
  const bad = session();
  h.receive(bad, 1, false);
  expect(await first).toMatchObject({ status: "failed", error: { code: "capability_mismatch" } });
  const accepted = session();
  h.receive(accepted);
  const duplicate = session();
  h.receive(duplicate);
  await flush();
  expect(bad.signouts).toBe(1);
  expect(duplicate.signouts).toBe(1);
  expect(accepted.signouts).toBe(0);
  expect(h.diagnostics.mock.calls.map(([d]) => d.code)).toEqual([
    "capability_mismatch",
    "duplicate_session_revoked",
  ]);
  accepted.session.free();
});

test("reset ends a passive drain and excludes its pending Session", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  h.created();
  h.context.leases = 0;
  const promise = h.start();
  h.controller.dispatch({ type: "ATTEMPT_TIMEOUT" });
  await promise;
  expect(h.commands).toContainEqual({
    type: "RetireFlow",
    flowId: 1,
    ms: h.context.timeouts.ringGraceMs,
  });
  h.controller.reset();
  const fake = session();
  h.receive(fake);
  await flush();
  expect(h.controller.getState().status).toBe("idle");
  expect(fake.signouts).toBe(1);
});

test("preparation is adopted and use-default abandons the custom flow without moving its canary", async () => {
  const h = setup(CUSTOM);
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  const promise = h.start(CUSTOM);
  h.created();
  h.controller.dispatch({ type: "READY", status: "valid" });
  h.controller.dispatch({ type: "USE_DEFAULT_INSTANCE", popup: WINDOW });
  expect(h.commands.filter((e) => e.type === "CreateFlow")).toEqual([
    { type: "CreateFlow", flowId: 1, instance: CUSTOM },
    { type: "CreateFlow", flowId: 2, instance: INSTANCE },
  ]);
  expect(h.commands).toContainEqual({ type: "FreeFlow", flowId: 1 });
  expect(h.commands.filter((e) => e.type === "NavigatePopup")).toEqual([
    { type: "NavigatePopup", flowId: 1, popup: WINDOW, origin: CUSTOM.origin },
  ]);
  const abandoned = session();
  h.receive(abandoned);
  h.created(2);
  const winner = session();
  h.receive(winner, 2);
  expect(await promise).toMatchObject({ status: "signed-in" });
  expect(h.controller.getState()).toMatchObject({ status: "signed-in", instance: INSTANCE });
  await flush();
  expect(abandoned.signouts).toBe(1);
  expect(
    JSON.stringify([h.controller.getState(), h.diagnostics.mock.calls, await promise]),
  ).not.toContain(CANARY);
  winner.session.free();
});

test("pagehide closes only the managed popup without resolving sign-in", async () => {
  const h = setup();
  const promise = h.start();
  h.created();
  h.controller.dispatch({ type: "PAGE_HIDE", persisted: true });
  expect(h.commands.filter((e) => e.type === "ClosePopup")).toEqual([]);
  h.controller.dispatch({ type: "PAGE_HIDE", persisted: false });
  expect(h.commands.at(-1)).toEqual({ type: "ClosePopup", popup: WINDOW });
  h.controller.cancel();
  await promise;
});

test.each([false, true])(
  "throwing observers cannot reject sign-in or prevent later observers (async=%s)",
  async (asyncThrow) => {
    const h = setup();
    const throws = () => {
      if (asyncThrow) return Promise.reject(new Error(CANARY));
      throw new Error(CANARY);
    };
    h.controller.subscribe(throws);
    h.controller.onSession(throws);
    h.diagnostics.mockImplementation(throws);
    const states = vi.fn();
    const delivered = vi.fn();
    h.controller.subscribe(states);
    h.controller.onSession(delivered);
    const promise = h.start();
    h.created();
    h.controller.dispatch({ type: "HANDSHAKE_HINT" });
    const fake = session();
    h.receive(fake);
    expect((await promise).status).toBe("signed-in");
    await flush();
    expect(delivered).toHaveBeenCalledOnce();
    expect(states).toHaveBeenLastCalledWith(h.controller.getState());
    fake.session.free();
  },
);

test("reentrant state dispatch waits until effects and state notification finish", async () => {
  const h = setup();
  const states: string[] = [];
  h.controller.subscribe((state) => {
    states.push(state.status);
    if (state.status === "opening") h.controller.cancel();
  });
  const coherent: boolean[] = [];
  h.controller.subscribe((state) => {
    coherent.push(h.controller.getState() === state);
  });
  expect(await h.start()).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(states).toEqual(["opening", "idle"]);
  expect(coherent).toEqual([true, true]);
  expect(h.commands.map((e) => e.type)).toEqual([
    "CreateFlow",
    "WatchPopup",
    "FreeFlow",
    "EndAttempt",
  ]);
});

test("a Session observer can start another attempt after the old cleanup completes", async () => {
  const h = setup();
  const first = h.start();
  h.created();
  let next: ReturnType<typeof h.start> | undefined;
  const unsubscribe = h.controller.onSession(() => {
    unsubscribe();
    next = h.start();
  });
  const fake = session();
  h.receive(fake);
  expect((await first).status).toBe("signed-in");
  expect(next).toBeDefined();
  expect(next).not.toBe(first);
  expect(h.controller.getState().status).toBe("opening");
  const order = h.commands.map((e) => e.type);
  expect(order.lastIndexOf("CreateFlow")).toBeGreaterThan(order.indexOf("EndAttempt"));
  h.controller.cancel();
  expect((await next)?.status).toBe("failed");
  fake.session.free();
});

test("synchronous port events are queued until the current effects finish", async () => {
  const h = setup();
  const original = h.port.run.getMockImplementation()!;
  let deadlineAtNavigation = false;
  h.port.run.mockImplementation((effect) => {
    original(effect);
    if (effect.type === "CreateFlow") h.created(effect.flowId);
    if (effect.type === "NavigatePopup")
      deadlineAtNavigation = [...h.clock.pending.values()].some(
        (item) => item.at === h.context.timeouts.attemptMs,
      );
  });
  const promise = h.start();
  expect(deadlineAtNavigation).toBe(true);
  expect(h.controller.getState()).toHaveProperty("ringLink");
  h.controller.cancel();
  await promise;
});

test("unexpected effect failures produce a sanitized internal result and still attempt cleanup", async () => {
  const h = setup();
  const original = h.port.run.getMockImplementation()!;
  h.port.run.mockImplementation((effect) => {
    original(effect);
    throw new Error(CANARY);
  });
  const result = await h.start();
  expect(result).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(h.commands.map((e) => e.type)).toContain("FreeFlow");
  expect(h.commands.map((e) => e.type)).toContain("EndAttempt");
  if (result.status === "failed")
    expect(
      [String(result.error), result.error.stack, String(result.error.cause)].join(" "),
    ).not.toContain(CANARY);
});

test("dispose is idempotent, removes observers and later starts resolve internal", async () => {
  const h = setup();
  const states = vi.fn();
  const unsubscribe = h.controller.subscribe(states);
  unsubscribe();
  unsubscribe();
  h.controller.dispose();
  h.controller.dispose();
  expect(h.port.dispose).toHaveBeenCalledOnce();
  expect(states).not.toHaveBeenCalled();
  expect(await h.start()).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(h.commands.filter((e) => e.type === "CreateFlow")).toEqual([]);
});

test("mapped flow failures preserve the typed error and settle exactly once", async () => {
  const h = setup();
  const promise = h.start();
  const error = new PassportError("network");
  const event: AttemptEvent = { type: "FLOW_FAILED", flowId: 1, error };
  h.controller.dispatch(event);
  h.controller.dispatch(event);
  expect(await promise).toEqual({ status: "failed", error });
  expect(h.commands.filter((e) => e.type === "EndAttempt")).toHaveLength(1);
});

test.each(["cancel", "dispose"] as const)(
  "a failed context read cannot prevent %s or late Session cleanup",
  async (method) => {
    const h = setup();
    const promise = h.start();
    h.created();
    h.readContext.mockImplementation(() => {
      throw new Error(CANARY);
    });
    h.controller[method]();
    expect(await promise).toMatchObject({
      status: "failed",
      error: { code: "cancelled", detail: { by: "app" } },
    });
    const fake = session();
    h.receive(fake);
    await flush();
    expect(fake.signouts).toBe(1);
    if (method === "dispose") expect(h.port.dispose).toHaveBeenCalledOnce();
  },
);

test("an initial context failure resolves safely and dispose still releases observers", async () => {
  const h = setup();
  h.readContext.mockImplementation(() => {
    throw new Error(CANARY);
  });
  expect(await h.start()).toMatchObject({ status: "failed", error: { code: "internal" } });
  h.controller.dispose();
  expect(h.port.dispose).toHaveBeenCalledOnce();
});

test("a stale command failure cannot terminate a different flow or attempt", async () => {
  const h = setup();
  const first = h.start();
  h.created();
  h.controller.dispatch({ type: "ATTEMPT_TIMEOUT" });
  await first;
  const next = h.start();
  const failures: AttemptEvent[] = [
    { type: "RUNTIME_FAILED", flowId: 1, error: new PassportError("internal") },
    {
      type: "RUNTIME_FAILED",
      attemptId: "not-the-current-attempt",
      error: new PassportError("internal"),
    },
  ];
  for (const failure of failures) h.controller.dispatch(failure);
  expect(h.controller.getState().status).toBe("opening");
  h.controller.cancel();
  await next;
});

test("a fresh retry with a failing context read resolves internal without a new flow", async () => {
  const h = setup();
  const first = h.start();
  h.controller.cancel();
  await first;
  h.readContext.mockImplementation(() => {
    throw new Error(CANARY);
  });
  const settled = vi.fn();
  void h.start().then(settled);
  await flush();
  expect(settled).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "internal" }),
    }),
  );
  expect(h.commands.filter((e) => e.type === "CreateFlow")).toHaveLength(1);
});

test.each(["preparing", "ready"] as const)(
  "command exceptions in %s use preparation backoff instead of synchronous retries",
  (state) => {
    const h = setup();
    h.context.leases = 1;
    if (state === "ready") {
      h.controller.dispatch({ type: "PREPARE" });
      h.created();
    }
    const original = h.port.run.getMockImplementation()!;
    let creates = 0;
    h.port.run.mockImplementation((effect) => {
      original(effect);
      if (effect.type === "CreateFlow" && ++creates <= 2) throw new Error(CANARY);
    });
    if (state === "preparing") h.controller.dispatch({ type: "PREPARE" });
    else
      h.controller.dispatch({
        type: "RUNTIME_FAILED",
        flowId: 1,
        error: new PassportError("internal"),
      });
    expect(h.controller.getState()).toMatchObject({
      status: "idle",
      lastError: { code: "internal" },
    });
    expect(creates).toBe(state === "preparing" ? 1 : 0);
    expect(h.commands.at(-1)).toEqual({ type: "FreeFlow", flowId: 1 });
    expect([...h.clock.pending.values()].some((item) => item.at === 5000)).toBe(true);
  },
);

test("a reentrant restart rejects the old Session without settling or closing the new attempt", async () => {
  const h = setup();
  const first = h.start();
  h.created();
  const accepted = session();
  const old = session();
  let next: ReturnType<typeof h.start> | undefined;
  const delivered = vi.fn(() => {
    next = h.start();
    h.receive(old, 1, false);
  });
  h.controller.onSession(delivered);
  h.receive(accepted);
  expect((await first).status).toBe("signed-in");
  expect(delivered).toHaveBeenCalledOnce();
  expect(next).toBeDefined();
  const settled = vi.fn();
  void next!.then(settled);
  await flush();
  expect(old.signouts).toBe(1);
  expect(old.frees).toBe(1);
  expect(settled).not.toHaveBeenCalled();
  expect(h.controller.getState().status).toBe("opening");
  expect(h.openWindows.has(WINDOW)).toBe(true);
  expect(h.commands.filter((effect) => effect.type === "EndAttempt")).toHaveLength(1);
  expect(h.diagnostics).toHaveBeenCalledWith(
    expect.objectContaining({ code: "duplicate_session_revoked" }),
  );
  h.controller.cancel();
  expect((await next)?.status).toBe("failed");
  accepted.session.free();
});

test("an unknown Session revokes once with an unattributed diagnostic and leaves signIn pending", async () => {
  const h = setup();
  const promise = h.start();
  h.created();
  const before = h.controller.getState();
  const states = vi.fn();
  const delivered = vi.fn();
  const settled = vi.fn();
  h.controller.subscribe(states);
  h.controller.onSession(delivered);
  void promise.then(settled);
  const unknown = session();
  h.receive(unknown, 99);
  await flush();
  expect(unknown.signouts).toBe(1);
  expect(unknown.frees).toBe(1);
  expect(h.diagnostics.mock.calls).toEqual([[{ code: "late_session_revoked" }]]);
  expect(h.controller.getState()).toBe(before);
  expect(states).not.toHaveBeenCalled();
  expect(delivered).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
  expect(h.openWindows.has(WINDOW)).toBe(true);
  const known = session();
  h.receive(known);
  expect((await promise).status).toBe("signed-in");
  expect(delivered).toHaveBeenCalledOnce();
  known.session.free();
});

test("an unknown Session is revoked even if the first context snapshot throws", async () => {
  const h = setup();
  const before = h.controller.getState();
  const read = h.readContext.getMockImplementation()!;
  h.readContext.mockImplementation(() => {
    throw new Error(CANARY);
  });
  const states = vi.fn();
  const delivered = vi.fn();
  h.controller.subscribe(states);
  h.controller.onSession(delivered);
  const unknown = session();
  expect(() => h.receive(unknown, 99)).not.toThrow();
  await flush();
  expect(unknown.signouts).toBe(1);
  expect(unknown.frees).toBe(1);
  expect(h.diagnostics.mock.calls).toEqual([[{ code: "late_session_revoked" }]]);
  expect(h.controller.getState()).toBe(before);
  expect(states).not.toHaveBeenCalled();
  expect(delivered).not.toHaveBeenCalled();
  expect(JSON.stringify([before, h.diagnostics.mock.calls])).not.toContain(CANARY);
  h.readContext.mockImplementation(read);
  const promise = h.start();
  h.created();
  const known = session();
  h.receive(known);
  expect((await promise).status).toBe("signed-in");
  known.session.free();
});

test("an owned mapped metadata failure revokes and settles the live result exactly once", async () => {
  const h = setup();
  const promise = h.start();
  h.created();
  const delivered = vi.fn();
  const settled = vi.fn();
  h.controller.onSession(delivered);
  void promise.then(settled);
  const error = new PassportError("internal", {
    messages: { "error.internal": "Snapshot unavailable" },
  });
  const fake = session();
  h.controller.receiveSession(1, fake.session, { error });
  expect(await promise).toEqual({ status: "failed", error });
  const before = h.controller.getState();
  const late = session();
  h.controller.receiveSession(1, late.session, { error: new PassportError("network") });
  await flush();
  expect(h.controller.getState()).toBe(before);
  expect(settled).toHaveBeenCalledOnce();
  expect(delivered).not.toHaveBeenCalled();
  expect(fake.signouts).toBe(1);
  expect(late.signouts).toBe(1);
  expect(fake.frees).toBe(1);
  expect(late.frees).toBe(1);
  expect(h.commands.filter((effect) => effect.type === "EndAttempt")).toHaveLength(1);
  expect(h.commands.some((effect) => effect.type === "RetireFlow")).toBe(false);
});

test.each([
  { from: INSTANCE, to: CUSTOM },
  { from: CUSTOM, to: INSTANCE },
])("cross-origin preparation from $from.host to $to.host is orphaned", async ({ from, to }) => {
  const h = setup(from);
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  const promise = h.start(to);
  h.context.leases = 0;
  h.created(1);
  const state = h.controller.getState();
  const old = session();
  h.receive(old, 1);
  expect(h.controller.getState()).toBe(state);
  h.created(2);
  const accepted = session();
  h.receive(accepted, 2);
  expect(await promise).toMatchObject({ status: "signed-in" });
  expect(h.controller.getState()).toMatchObject({ status: "signed-in", instance: to });
  expect(h.commands.filter((effect) => effect.type === "NavigatePopup")).toEqual([
    { type: "NavigatePopup", flowId: 2, popup: WINDOW, origin: to.origin },
  ]);
  await flush();
  expect(old.signouts).toBe(1);
  expect(old.frees).toBe(1);
  accepted.session.free();
});

test("a signIn waiting on a markerless return settles resume_failed while the view stays silent", async () => {
  const h = setup();
  h.controller.dispatch({
    type: "RETURN_DETECTED",
    valid: true,
    marker: "none",
    instance: INSTANCE,
    attemptId: "saved-attempt-01234567",
  });
  h.controller.dispatch({ type: "RESUMED", flowId: 1 });
  // A live, non-blocked attempt shares its reservation with a repeated signIn (POP-12).
  const waiting = h.controller.reserveResult();
  const states = vi.fn();
  h.controller.subscribe(states);
  h.controller.dispatch({ type: "FINISHING_TIMEOUT" });
  expect(h.controller.getState()).toEqual({ status: "idle", instance: INSTANCE });
  expect(states).toHaveBeenCalledExactlyOnceWith({ status: "idle", instance: INSTANCE });
  expect(await waiting).toMatchObject({ status: "failed", error: { code: "resume_failed" } });
  expect(h.diagnostics).not.toHaveBeenCalled();
});
