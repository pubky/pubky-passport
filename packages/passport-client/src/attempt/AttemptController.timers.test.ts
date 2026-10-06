import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeSession } from "../../test/FakeSession.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { createRingLink } from "../shared/RingLink.js";
import { AttemptController } from "./AttemptController.js";
import type { AttemptCommand } from "./AttemptEffectPort.js";
import { startAttempt } from "../../test/startAttempt.js";

const INSTANCE = {
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
};
const popup = Object.freeze({ name: "managed" }) as unknown as Window;
const owners: { controller: AttemptController; clock: FakeClock }[] = [];
const sessions: FakeSession[] = [];
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(async () => {
  for (const { controller } of owners) controller.dispose();
  await flush();
  for (const { clock } of owners.splice(0)) clock.assertEmpty();
  for (const session of sessions.splice(0)) session.assertFreed();
});
function setup(clock = new FakeClock()) {
  let id = 0;
  const timeouts = resolveClientOptions({}, (value) => value).timeouts;
  // No profile: an optional-profile sign-in finishes without one.
  const run = vi.fn<(effect: AttemptCommand) => void>((effect) => {
    if (effect.type === "CheckProfile")
      controller.dispatch({ type: "PROFILE_MISSING", sessionId: effect.sessionId });
  });
  const diagnostic = vi.fn();
  const controller = new AttemptController(
    INSTANCE,
    () => ({
      defaultInstance: INSTANCE,
      attemptId: `timer-attempt-${++id}`,
      now: clock.now(),
      leases: 0,
      visible: true,
      profile: "optional" as const,
      timeouts,
    }),
    { run, dispose: () => {} },
    diagnostic,
    clock,
  );
  owners.push({ controller, clock });
  const start = () => startAttempt(controller, { type: "SIGN_IN", popup, instance: INSTANCE });
  const created = (flowId = 1) =>
    controller.dispatch({
      type: "FLOW_CREATED",
      flowId,
      ringLink: createRingLink(() => "pubkyauth://" + ["timer", "private"].join("-")),
    });
  const ready = () => controller.dispatch({ type: "READY", status: "valid" });
  const receive = (fake: FakeSession, flowId = 1) =>
    controller.receiveSession(flowId, fake.session, {
      publicKey: "approved-key",
      capabilities: [],
      capabilitiesMatch: true,
    });
  return { controller, clock, run, diagnostic, timeouts, start, created, ready, receive };
}
function session(outcome?: (call: number) => Promise<void>) {
  const fake = new FakeSession(outcome);
  sessions.push(fake);
  return fake;
}

test("handshake hint waits for its deadline and a ready reply cancels it", async () => {
  const h = setup();
  const first = h.start();
  h.created();
  h.clock.advance(h.timeouts.handshakeHintMs - 1);
  expect(h.controller.getState().status).toBe("opening");
  h.clock.advance(1);
  expect(h.controller.getState()).toMatchObject({ status: "waiting", handshake: "unconfirmed" });
  expect(h.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: "handshake_missing" }));
  h.controller.cancel();
  await first;
  const second = h.start();
  h.created(2);
  h.ready();
  h.diagnostic.mockClear();
  h.clock.advance(h.timeouts.handshakeHintMs);
  expect(h.diagnostic).not.toHaveBeenCalled();
  expect(h.controller.getState()).toMatchObject({ handshake: "confirmed" });
  h.controller.cancel();
  await second;
});

test.each([false, true])(
  "closed windows keep polling for the correct grace (Ring=%s)",
  async (ring) => {
    const h = setup();
    const result = h.start();
    h.created();
    h.ready();
    if (ring) h.controller.dispatch({ type: "STATUS", phase: "ring" });
    h.controller.dispatch({ type: "POPUP_CLOSED" });
    const ms = ring ? h.timeouts.ringGraceMs : h.timeouts.closedGraceMs;
    h.clock.advance(ms - 1);
    expect(h.controller.getState()).toMatchObject({ status: "waiting", window: "closed" });
    expect(h.run.mock.calls.flat().filter((e) => e.type === "FreeFlow")).toEqual([]);
    h.clock.advance(1);
    const outcome = await result;
    expect(outcome).toMatchObject({ status: "failed", error: { code: "popup_closed" } });
    expect(h.run.mock.calls.flat().filter((e) => e.type === "EndAttempt")).toEqual([
      {
        type: "EndAttempt",
        by: "passive",
        error: outcome.status === "failed" ? outcome.error : undefined,
      },
    ]);
    h.clock.assertEmpty();
  },
);

test("a detached popup keeps the flow until its longer deadline", async () => {
  const h = setup();
  const result = h.start();
  h.created();
  h.controller.dispatch({ type: "POPUP_CLOSED" });
  h.clock.advance(h.timeouts.detachedMs - 1);
  expect(h.controller.getState().status).toBe("detached");
  h.clock.advance(1);
  expect(await result).toMatchObject({ status: "failed", error: { code: "timeout" } });
  h.clock.assertEmpty();
});

test("a success outcome still times out when no SDK Session arrives", async () => {
  const h = setup();
  const result = h.start();
  h.created();
  h.ready();
  h.controller.dispatch({ type: "OUTCOME", outcome: "success", version: 2, messageId: "one" });
  h.clock.advance(h.timeouts.finishingMs - 1);
  expect(h.controller.getState().status).toBe("finishing");
  h.clock.advance(1);
  expect(await result).toMatchObject({ status: "failed", error: { code: "timeout" } });
  h.clock.assertEmpty();
});

test("the overall attempt deadline bounds an otherwise open popup", async () => {
  const h = setup();
  const result = h.start();
  h.created();
  h.ready();
  h.clock.advance(h.timeouts.attemptMs - 1);
  expect(h.controller.getState().status).toBe("waiting");
  h.clock.advance(1);
  expect(await result).toMatchObject({ status: "failed", error: { code: "timeout" } });
  h.clock.assertEmpty();
});

test.each(["Session", "cancel"] as const)(
  "%s invalidates queued deadlines before another attempt starts",
  async (end) => {
    const h = setup();
    const first = h.start();
    h.created();
    const stale = [...h.clock.captured];
    if (end === "Session") {
      const fake = session();
      h.receive(fake);
      fake.session.free();
    } else h.controller.cancel();
    await first;
    h.clock.assertEmpty();
    const second = h.start();
    h.created(2);
    for (const callback of stale) callback();
    expect(h.controller.getState().status).toBe("opening");
    h.controller.reset();
    expect(h.controller.getState().status).toBe("opening");
    h.controller.cancel();
    await second;
    h.clock.assertEmpty();
  },
);

test("ending one controller cannot cancel another controller's deadline", async () => {
  const clock = new FakeClock();
  const a = setup(clock);
  const b = setup(clock);
  const first = a.start();
  const second = b.start();
  a.created();
  b.created();
  b.ready();
  a.controller.cancel();
  await first;
  expect(clock.pending.size).toBe(1);
  clock.advance(b.timeouts.attemptMs);
  expect(await second).toMatchObject({ status: "failed", error: { code: "timeout" } });
  clock.assertEmpty();
});

test("Session revocation retry survives disposal of attempt timers", async () => {
  const h = setup();
  const result = h.start();
  h.created();
  h.controller.dispose();
  await result;
  const fake = session(async (call) => {
    if (call === 1) throw new Error("retry revocation");
  });
  h.receive(fake);
  await flush();
  expect(fake.signouts).toBe(1);
  expect(fake.frees).toBe(0);
  h.clock.advance(1999);
  await flush();
  expect(fake.signouts).toBe(1);
  h.clock.advance(1);
  await flush();
  expect(fake.signouts).toBe(2);
  fake.assertFreed();
  h.clock.assertEmpty();
});

test("a throwing timer scheduler becomes an internal result and still cleans the attempt", async () => {
  const h = setup();
  vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error("timer failure");
  });
  expect(await h.start()).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ type: "EndAttempt" }));
  h.clock.assertEmpty();
});
