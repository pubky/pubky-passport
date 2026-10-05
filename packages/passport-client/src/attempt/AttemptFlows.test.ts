import type { Session } from "@synonymdev/pubky";
import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import type { FlowHandle, FlowResult } from "../flow/FlowPort.js";
import { FlowRegistry } from "../flow/FlowRegistry.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { AttemptController } from "./AttemptController.js";
import type { AttemptCommand } from "./AttemptEffectPort.js";
import { startAttempt } from "../../test/startAttempt.js";

const DEFAULT = {
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
};
const CUSTOM = {
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
};
const POPUP = {} as Window;
const CANARY = ["attempt", "private", "payload"].join("-");
const resources: { requests: { flow: FakeFlowPort }[]; clock: FakeClock }[] = [];
const sessions: FakeSession[] = [];
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
afterEach(() => {
  for (const h of resources.splice(0)) {
    for (const r of h.requests) r.flow.assertFreed();
    h.clock.assertEmpty();
  }
  for (const fake of sessions.splice(0)) fake.assertFreed();
});

function setup(selection: PassportInstance = DEFAULT) {
  const clock = new FakeClock();
  const context = {
    defaultInstance: DEFAULT,
    attemptId: "attempt",
    now: 0,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: resolveClientOptions({}, (v) => v).timeouts,
  };
  const requests: {
    flow: FakeFlowPort;
    instance: PassportInstance;
    resolve: () => void;
    resolved: boolean;
  }[] = [];
  const commands: AttemptCommand[] = [];
  const navigations: { origin: string; url: string | undefined }[] = [];
  const pins = new Map<number, string>();
  const grants = new WeakMap<Session, boolean>();
  const diagnostics = vi.fn();
  const received = vi.fn();
  const registry = new FlowRegistry(
    (instance) => ({
      start() {
        let resolve!: (result: FlowResult<FlowHandle>) => void;
        const pending = new Promise<FlowResult<FlowHandle>>((settle) => {
          resolve = settle;
        });
        const flow = new FakeFlowPort(`pubkyauth://${CANARY}-${requests.length}`);
        const record = {
          flow,
          instance,
          resolved: false,
          resolve() {
            if (!record.resolved) {
              record.resolved = true;
              resolve({ ok: true, value: flow });
            }
          },
        };
        requests.push(record);
        return pending;
      },
      resume() {
        throw new Error("This popup scenario cannot resume");
      },
    }),
    {
      event: (event) => controller.dispatch(event),
      // Test metadata is known in advance; no SDK inspection precedes the ownership claim.
      session: (id, session) =>
        controller.receiveSession(id, session, {
          publicKey: "approved-key",
          capabilities: [],
          capabilitiesMatch: grants.get(session) ?? true,
        }),
      diagnostic: diagnostics,
    },
    clock,
  );
  const effects = {
    run(command: AttemptCommand) {
      commands.push(command);
      switch (command.type) {
        case "CreateFlow":
          expect(command.returnTo).toBeUndefined();
          pins.set(command.flowId, command.instance.origin);
          registry.create(command.flowId, command.instance);
          break;
        case "StartPolling":
          registry.start(command.flowId);
          break;
        case "FreeFlow":
          registry.free(command.flowId);
          break;
        case "RetireFlow":
          registry.retire(command.flowId, command.ms);
          break;
        // No profile: an optional-profile sign-in finishes without one.
        case "CheckProfile":
          controller.dispatch({ type: "PROFILE_MISSING", sessionId: command.sessionId });
          break;
        case "NavigatePopup":
          expect(command.origin).toBe(pins.get(command.flowId));
          navigations.push({
            origin: command.origin,
            url: registry.authorizationUrl(command.flowId),
          });
          break;
      }
    },
    dispose: () => registry.dispose(),
  };
  let attempt = 0;
  const controller = new AttemptController(
    selection,
    () => ({ ...context, now: clock.now(), attemptId: `attempt-${++attempt}` }),
    effects,
    diagnostics,
    clock,
  );
  controller.onSession(received);
  const snapshots: string[] = [];
  controller.subscribe((state) => {
    snapshots.push(JSON.stringify(state));
  });
  resources.push({ requests, clock });
  const start = (instance = DEFAULT as PassportInstance) =>
    startAttempt(controller, { type: "SIGN_IN", instance, popup: POPUP });
  const ready = async (index = 0) => {
    requests[index]!.resolve();
    await flush();
  };
  const approve = async (index = 0, matches = true) => {
    const fake = new FakeSession();
    sessions.push(fake);
    grants.set(fake.session, matches);
    requests[index]!.flow.settle(fake.session);
    await flush();
    return fake;
  };
  const finish = async () => {
    controller.dispose();
    for (const request of requests) request.resolve();
    await flush();
    for (const request of requests) if (request.flow.pending) request.flow.settle();
    await flush();
    expect(JSON.stringify([snapshots, commands, diagnostics.mock.calls])).not.toContain(CANARY);
  };
  return {
    controller,
    registry,
    context,
    requests,
    commands,
    navigations,
    diagnostics,
    received,
    snapshots,
    clock,
    start,
    ready,
    approve,
    finish,
  };
}

test("cancelling a pending creation frees its eventual handle without navigating", async () => {
  const h = setup();
  const promise = h.start();
  h.controller.cancel();
  expect((await promise).status).toBe("failed");
  await h.ready();
  expect(h.requests[0]!.flow.polls).toBe(0);
  expect(h.requests[0]!.flow.frees).toBe(1);
  expect(h.navigations).toEqual([]);
  await h.finish();
});

test("a prepared pending flow is adopted by repeated clicks and delivers one exact Session", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  const promise = h.start();
  expect(h.start()).toBe(promise);
  expect(h.requests).toHaveLength(1);
  await h.ready();
  expect(h.requests[0]!.flow.polls).toBe(1);
  const fake = await h.approve();
  expect(await promise).toMatchObject({
    status: "signed-in",
    session: fake.session,
    info: { publicKey: "approved-key" },
  });
  expect(h.received).toHaveBeenCalledOnce();
  expect(h.navigations).toHaveLength(1);
  fake.session.free();
  await h.finish();
});

test.each(["timeout", "closed"])(
  "a Session from the pending poll after %s signs in by event without settling twice",
  async (reason) => {
    const h = setup();
    const promise = h.start();
    const settled = vi.fn();
    void promise.then(settled);
    await h.ready();
    h.controller.dispatch({ type: "READY", status: "valid" });
    if (reason === "closed") {
      h.controller.dispatch({ type: "POPUP_CLOSED" });
      h.clock.advance(h.context.timeouts.closedGraceMs);
    } else h.clock.advance(h.context.timeouts.attemptMs);
    expect((await promise).status).toBe("failed");
    expect(h.requests[0]!.flow.frees).toBe(0);
    const fake = await h.approve();
    expect(h.controller.getState().status).toBe("signed-in");
    expect(h.received).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledOnce();
    fake.session.free();
    await h.finish();
  },
);

test.each(["cancel", "dispose", "reset"] as const)(
  "%s revokes the late pending Session once",
  async (method) => {
    const h = setup();
    const promise = h.start();
    await h.ready();
    if (method === "reset") h.clock.advance(h.context.timeouts.attemptMs);
    h.controller[method]();
    await promise;
    const fake = await h.approve();
    expect(fake.signouts).toBe(1);
    expect(h.received).not.toHaveBeenCalled();
    expect(h.diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ code: "late_session_revoked" }),
    );
    await h.finish();
  },
);

test("a retired prepared flow keeps polling after timeout and its approval remains eligible", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await h.ready();
  h.context.leases = 0;
  const promise = h.start();
  h.clock.advance(h.context.timeouts.attemptMs);
  await promise;
  h.requests[0]!.flow.settle();
  await flush();
  h.clock.advance(0);
  expect(h.requests[0]!.flow.polls).toBe(2);
  const fake = await h.approve();
  expect(h.received).toHaveBeenCalledOnce();
  expect(h.controller.getState().status).toBe("signed-in");
  fake.session.free();
  await h.finish();
});

test("a drain error frees its handle without replacing the already resolved timeout", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await h.ready();
  h.context.leases = 0;
  const promise = h.start();
  h.clock.advance(h.context.timeouts.attemptMs);
  const result = await promise;
  h.requests[0]!.flow.fail(Object.assign(new Error(CANARY), { name: "RequestError" }));
  await flush();
  expect(h.requests[0]!.flow.frees).toBe(1);
  expect(h.controller.getState()).toMatchObject({ status: "failed", error: { code: "timeout" } });
  expect(result).toMatchObject({ status: "failed", error: { code: "timeout" } });
  await h.finish();
});

test("a live exposed flow error reenters retirement and a second drain error frees it", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await h.ready();
  h.context.leases = 0;
  const promise = h.start();
  h.requests[0]!.flow.fail(Object.assign(new Error(CANARY), { name: "RequestError" }));
  await flush();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "network" } });
  expect(h.requests[0]!.flow.polls).toBe(2);
  h.requests[0]!.flow.fail(new Error(CANARY));
  await flush();
  expect(h.requests[0]!.flow.frees).toBe(1);
  await h.finish();
});

test("use-default creates a fresh request and never navigates the old secret to the new origin", async () => {
  const h = setup();
  const promise = h.start(CUSTOM);
  await h.ready();
  h.controller.dispatch({ type: "READY", status: "valid" });
  h.controller.dispatch({ type: "USE_DEFAULT_INSTANCE", popup: POPUP });
  await h.ready(1);
  expect(h.navigations).toEqual([
    { origin: CUSTOM.origin, url: h.requests[0]!.flow.url },
    { origin: DEFAULT.origin, url: h.requests[1]!.flow.url },
  ]);
  expect(h.requests[0]!.flow.url).not.toBe(h.requests[1]!.flow.url);
  const abandoned = await h.approve(0);
  expect(abandoned.signouts).toBe(1);
  const winner = await h.approve(1);
  expect(await promise).toMatchObject({ status: "signed-in" });
  expect(h.controller.getState()).toMatchObject({ status: "signed-in", instance: DEFAULT });
  winner.session.free();
  await h.finish();
});

test.each([true, false])(
  "use-default after failure stops the custom drain without freeing its pending poll (Session=%s)",
  async (sessionArrives) => {
    const h = setup(CUSTOM);
    h.context.leases = 1;
    h.controller.dispatch({ type: "PREPARE" });
    await h.ready();
    const first = h.start(CUSTOM);
    h.context.leases = 0;
    h.controller.dispatch({ type: "READY", status: "valid" });
    h.clock.advance(h.context.timeouts.attemptMs);
    expect(await first).toMatchObject({ status: "failed", error: { code: "timeout" } });
    const old = h.requests[0]!.flow;
    expect(old.pending).toBe(true);
    expect(old.frees).toBe(0);
    expect(h.commands).toContainEqual({
      type: "RetireFlow",
      flowId: 1,
      ms: h.context.timeouts.ringGraceMs,
    });

    const from = h.commands.length;
    h.controller.dispatch({ type: "USE_DEFAULT_INSTANCE", popup: POPUP });
    expect(h.requests).toHaveLength(2);
    const effects = h.commands.slice(from);
    expect(effects.filter((e) => e.type === "FreeFlow")).toEqual([{ type: "FreeFlow", flowId: 1 }]);
    expect(effects.some((e) => e.type === "RetireFlow")).toBe(false);
    expect(effects.findIndex((e) => e.type === "FreeFlow")).toBeLessThan(
      effects.findIndex((e) => e.type === "CreateFlow"),
    );
    expect(old.frees).toBe(0);
    expect(old.polls).toBe(1);
    await h.ready(1);
    const before = h.controller.getState();
    const endCount = h.commands.filter((e) => e.type === "EndAttempt").length;
    if (sessionArrives) {
      const abandoned = await h.approve(0);
      expect(abandoned.signouts).toBe(1);
      expect(abandoned.frees).toBe(1);
      expect(h.diagnostics).toHaveBeenCalledWith(
        expect.objectContaining({ code: "late_session_revoked" }),
      );
    } else {
      old.settle();
      await flush();
    }
    h.clock.advance(0);
    expect(old.frees).toBe(1);
    expect(old.polls).toBe(1);
    expect(old.pending).toBe(false);
    expect(h.controller.getState()).toBe(before);
    expect(h.commands.filter((e) => e.type === "EndAttempt")).toHaveLength(endCount);
    expect(h.received).not.toHaveBeenCalled();
    // A ready flow's first popup URL is opened synchronously by the facade.
    expect(h.navigations).toEqual([{ origin: DEFAULT.origin, url: h.requests[1]!.flow.url }]);
    expect(old.url).not.toBe(h.requests[1]!.flow.url);
    const winner = await h.approve(1);
    expect(h.received).toHaveBeenCalledExactlyOnceWith(
      winner.session,
      expect.objectContaining({ publicKey: "approved-key" }),
    );
    expect(h.controller.getState()).toMatchObject({ status: "signed-in", instance: DEFAULT });
    winner.session.free();
    h.controller.reset();
    expect(h.controller.getState()).toMatchObject({ status: "idle", instance: CUSTOM });
    await h.finish();
  },
);

test.each([true, false])(
  "a rotated drain can complete before the fresh flow (first capabilities match=%s)",
  async (matches) => {
    const h = setup();
    h.context.leases = 1;
    h.controller.dispatch({ type: "PREPARE" });
    await h.ready();
    h.clock.advance(h.context.timeouts.ringLinkRotateMs);
    await h.ready(1);
    h.context.leases = 0;
    const first = await h.approve(0, matches);
    expect(h.controller.getState().status).toBe(matches ? "signed-in" : "failed");
    const second = await h.approve(1);
    expect(h.received).toHaveBeenCalledOnce();
    if (matches) {
      expect(second.signouts).toBe(1);
      expect(h.diagnostics).toHaveBeenCalledWith(
        expect.objectContaining({ code: "duplicate_session_revoked" }),
      );
      first.session.free();
    } else {
      expect(first.signouts).toBe(1);
      expect(h.controller.getState().status).toBe("signed-in");
      second.session.free();
    }
    await h.finish();
  },
);

test("success outcomes and failing app observers cannot fabricate or lose a Session", async () => {
  const h = setup();
  const promise = h.start();
  await h.ready();
  h.controller.dispatch({ type: "OUTCOME", outcome: "success", messageId: "outcome", version: 2 });
  expect(h.controller.getState().status).toBe("finishing");
  expect(h.received).not.toHaveBeenCalled();
  h.controller.onSession(() => {
    throw new Error(CANARY);
  });
  const fake = await h.approve();
  expect(await promise).toMatchObject({ status: "signed-in", session: fake.session });
  expect(fake.signouts).toBe(0);
  fake.session.free();
  await h.finish();
});
