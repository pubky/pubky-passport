import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeSession } from "../../test/FakeSession.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { PassportError } from "../errors/PassportError.js";
import { createRingLink } from "../shared/RingLink.js";
import { AttemptController } from "./AttemptController.js";
import type { AttemptCommand } from "./AttemptEffectPort.js";
import { startAttempt } from "../../test/startAttempt.js";

const INSTANCE = {
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
};
const resources: { controller: AttemptController; clock: FakeClock }[] = [];
afterEach(() => {
  for (const h of resources.splice(0)) {
    h.controller.dispose();
    h.clock.assertEmpty();
  }
});
function setup() {
  const clock = new FakeClock();
  const effects = {
    // No profile: an optional-profile sign-in finishes without one.
    run: vi.fn((command: AttemptCommand) => {
      if (command.type === "CheckProfile")
        controller.dispatch({ type: "PROFILE_MISSING", sessionId: command.sessionId });
    }),
    dispose: vi.fn(),
  };
  const context = {
    defaultInstance: INSTANCE,
    attemptId: "reserved-attempt",
    now: 0,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: resolveClientOptions({}, (input) => input).timeouts,
  };
  const read = vi.fn(() => context);
  const controller = new AttemptController(INSTANCE, read, effects, undefined, clock);
  resources.push({ controller, clock });
  return { controller, effects, read, clock, context };
}

test("reserving before native opening creates no attempt, browser work, flow or context read", async () => {
  const h = setup();
  const before = h.controller.snapshot();
  expect(h.controller.reservedResult()).toBeUndefined();
  const promise = h.controller.reserveResult();
  expect(h.controller.reserveResult()).toBe(promise);
  expect(h.controller.reservedResult()).toBe(promise);
  expect(h.controller.snapshot()).toBe(before);
  expect(h.read).not.toHaveBeenCalled();
  expect(h.effects.run).not.toHaveBeenCalled();
  expect(h.clock.pending.size).toBe(0);
  expect(
    startAttempt(h.controller, { type: "SIGN_IN", instance: INSTANCE, popup: undefined }),
  ).toBe(promise);
  expect(h.controller.getState().status).toBe("opening");
  expect(h.effects.run).toHaveBeenCalledExactlyOnceWith({
    type: "CreateFlow",
    flowId: 1,
    instance: INSTANCE,
  });
  h.controller.cancel();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
});

test.each(["idle", "failed", "signed-in"] as const)(
  "cancellation settles a native-open reservation from %s",
  async (from) => {
    const h = setup();
    if (from !== "idle") {
      const prior = startAttempt(h.controller, {
        type: "SIGN_IN",
        instance: INSTANCE,
        popup: undefined,
      });
      if (from === "failed")
        h.controller.dispatch({
          type: "FLOW_FAILED",
          flowId: 1,
          error: new PassportError("network"),
        });
      else {
        const fake = new FakeSession();
        h.controller.receiveSession(1, fake.session, {
          publicKey: "approved-key",
          capabilities: [],
          capabilitiesMatch: true,
        });
        fake.session.free();
        fake.assertFreed();
      }
      await prior;
    }
    const before = h.controller.getState();
    const promise = h.controller.reserveResult();
    const settled = vi.fn();
    void promise.then(settled);
    h.controller.cancel();
    expect(await promise).toMatchObject({
      status: "failed",
      error: { code: "cancelled", detail: { by: "app" } },
    });
    expect(h.controller.reservedResult()).toBeUndefined();
    expect(h.controller.getState()).toBe(before);
    h.controller.cancel();
    expect(settled).toHaveBeenCalledOnce();
  },
);

test("a Session on a prepared flow can settle the reserved result before a popup event", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  h.controller.dispatch({
    type: "FLOW_CREATED",
    flowId: 1,
    ringLink: createRingLink(() => "test-link"),
  });
  const promise = h.controller.reserveResult();
  const fake = new FakeSession();
  try {
    h.controller.receiveSession(1, fake.session, {
      publicKey: "approved-key",
      capabilities: [],
      capabilitiesMatch: true,
    });
    expect((await promise).status).toBe("signed-in");
    expect(h.controller.reservedResult()).toBeUndefined();
    expect(h.controller.getState().status).toBe("signed-in");
  } finally {
    fake.session.free();
    fake.assertFreed();
  }
});

test("a failed old native opener cannot settle a newer reservation created by a Session observer", async () => {
  const h = setup();
  const first = h.controller.reserveResult();
  startAttempt(h.controller, { type: "SIGN_IN", instance: INSTANCE, popup: undefined });
  let next: Promise<unknown> | undefined;
  h.controller.onSession(() => {
    next = h.controller.reserveResult();
  });
  const fake = new FakeSession();
  h.controller.receiveSession(1, fake.session, {
    publicKey: "approved-key",
    capabilities: [],
    capabilitiesMatch: true,
  });
  fake.session.free();
  fake.assertFreed();
  expect((await first).status).toBe("signed-in");
  expect(next).toBeDefined();
  const settled = vi.fn();
  void next!.then(settled);
  h.controller.failReservedResult(first, new PassportError("internal"));
  await Promise.resolve();
  expect(h.controller.reservedResult()).toBe(next);
  expect(settled).not.toHaveBeenCalled();
  h.controller.cancel();
  expect(await next).toMatchObject({ status: "failed", error: { code: "cancelled" } });
});

test("failure and dispose settle reservations once; disposal refuses later reservations", async () => {
  const h = setup();
  const error = new PassportError("internal", {
    messages: { "error.internal": "Safe caller copy" },
  });
  const first = h.controller.reserveResult();
  h.controller.failReservedResult(first, error);
  expect(await first).toEqual({ status: "failed", error });
  const second = h.controller.reserveResult();
  h.controller.dispose();
  h.controller.failReservedResult(first, error);
  expect(await second).toMatchObject({
    status: "failed",
    error: { code: "cancelled", detail: { by: "app" } },
  });
  expect(await h.controller.reserveResult()).toMatchObject({
    status: "failed",
    error: { code: "internal" },
  });
  expect(h.controller.reservedResult()).toBeUndefined();
  expect(h.effects.dispose).toHaveBeenCalledOnce();
});

test("redirect settlement requires the current callback flow to be created", async () => {
  const h = setup();
  const idle = h.controller.snapshot();
  const promise = startAttempt(h.controller, {
    type: "SIGN_IN",
    instance: INSTANCE,
    route: { kind: "redirect", cause: "preferred" },
  });
  h.controller.completeRedirect(idle);
  // The callback flow is still being created: nothing to navigate to yet.
  const creating = h.controller.snapshot();
  h.controller.completeRedirect(creating);
  h.controller.dispatch({
    type: "FLOW_CREATED",
    flowId: 1,
    ringLink: createRingLink(() => "private-link"),
  });
  const created = h.controller.snapshot();
  h.controller.completeRedirect(creating);
  expect(h.controller.reservedResult()).toBe(promise);
  h.controller.completeRedirect(created);
  expect(await promise).toEqual({ status: "redirecting" });
  expect(h.controller.snapshot()).toBe(created);
  expect(h.controller.reservedResult()).toBeUndefined();
  expect(
    h.effects.run.mock.calls.flat().some((e) => e.type === "FreeFlow" || e.type === "StartPolling"),
  ).toBe(false);
});

test("a popup result cannot be settled as a redirect", async () => {
  const h = setup();
  const promise = startAttempt(h.controller, {
    type: "SIGN_IN",
    instance: INSTANCE,
    popup: undefined,
  });
  h.controller.dispatch({
    type: "FLOW_CREATED",
    flowId: 1,
    ringLink: createRingLink(() => "private-link"),
  });
  h.controller.completeRedirect(h.controller.snapshot());
  expect(h.controller.reservedResult()).toBe(promise);
  h.controller.cancel();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
});

test("disposal requested inside the navigation effect takes precedence over result settlement", async () => {
  const h = setup();
  h.effects.run.mockImplementation((command) => {
    if (command.type === "SaveStateAndNavigate") {
      h.controller.dispose();
      h.controller.completeRedirect(h.controller.snapshot());
    }
  });
  const promise = startAttempt(h.controller, {
    type: "SIGN_IN",
    instance: INSTANCE,
    route: { kind: "redirect", cause: "preferred" },
  });
  h.controller.dispatch({
    type: "FLOW_CREATED",
    flowId: 1,
    ringLink: createRingLink(() => "private-link"),
  });
  expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(h.controller.snapshot().disposed).toBe(true);
});

test("a stale navigation completion cannot settle a later redirect attempt", async () => {
  const h = setup();
  const event = {
    type: "SIGN_IN" as const,
    instance: INSTANCE,
    route: { kind: "redirect" as const, cause: "preferred" as const },
  };
  const first = startAttempt(h.controller, event);
  h.controller.dispatch({
    type: "FLOW_CREATED",
    flowId: 1,
    ringLink: createRingLink(() => "private-link"),
  });
  const prior = h.controller.snapshot();
  h.controller.cancel();
  expect(await first).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  h.context.attemptId = "another-attempt";
  const next = startAttempt(h.controller, event);
  h.controller.dispatch({
    type: "FLOW_CREATED",
    flowId: 2,
    ringLink: createRingLink(() => "new-link"),
  });
  h.controller.completeRedirect(prior);
  expect(h.controller.reservedResult()).toBe(next);
  h.controller.completeRedirect(h.controller.snapshot());
  expect(await next).toEqual({ status: "redirecting" });
});
