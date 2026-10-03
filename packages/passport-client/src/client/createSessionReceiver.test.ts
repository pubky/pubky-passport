import type { Session } from "@synonymdev/pubky";
import { afterEach, expect, test, vi, type Mock } from "vitest";
import { AttemptController } from "../attempt/AttemptController.js";
import type { AttemptCommand } from "../attempt/AttemptEffectPort.js";
import type { AttemptContext } from "../attempt/attemptModel.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { FlowRegistry } from "../flow/FlowRegistry.js";
import type { FlowPort, FlowResult, FlowSessionInfo } from "../flow/FlowPort.js";
import { createPubkyFlowAdapter, validateCapabilities } from "../flow/pubkyFlowAdapter.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import { createSessionReceiver } from "./createSessionReceiver.js";
import { startAttempt } from "../../test/startAttempt.js";

const DEFAULT: PassportInstance = Object.freeze({
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
});
const CUSTOM: PassportInstance = Object.freeze({
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
});
const CAPABILITIES = "/pub/example.app/:rw";
const CANARY = ["session", "private", "material"].join("-");
const resources: {
  controller: AttemptController;
  flows: FakeFlowPort[];
  sessions: FakeSession[];
  transferred: Set<Session>;
  clock: FakeClock;
}[] = [];
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

afterEach(async () => {
  for (const h of resources.splice(0)) {
    h.controller.dispose();
    for (const flow of h.flows) if (flow.pending) flow.settle();
    await flush();
    h.clock.advance(2000);
    await flush();
    for (const flow of h.flows) flow.assertFreed();
    for (const fake of h.sessions) {
      if (h.transferred.has(fake.session) && !fake.frees) fake.session.free();
      fake.assertFreed();
    }
    h.clock.assertEmpty();
  }
});

function setup(selection: PassportInstance = DEFAULT) {
  const clock = new FakeClock();
  const context: AttemptContext & { leases: number } = {
    defaultInstance: DEFAULT,
    attemptId: "",
    now: 0,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: resolveClientOptions({}, validateCapabilities).timeouts,
    appName: "Inbox",
    messages: {
      "error.internal": "Read failed for {appName} at {instanceHost}; default {defaultHost}.",
    },
  };
  const errors = {
    messages: context.messages!,
    context: { appName: "Inbox", defaultHost: DEFAULT.host },
  };
  const diagnostics = vi.fn<(diagnostic: PassportDiagnostic) => void>();
  const delivered = vi.fn();
  const transferred = new Set<Session>();
  const states = vi.fn();
  const commands: AttemptCommand[] = [];
  const flows: FakeFlowPort[] = [];
  const sessions: FakeSession[] = [];
  const snapshots: FlowResult<FlowSessionInfo>[] = [];
  const adapter = vi.fn((instance: PassportInstance): Pick<FlowPort, "sessionInfo"> => {
    const port = createPubkyFlowAdapter(
      {
        appName: "Inbox",
        clientId: "example.app",
        capabilities: CAPABILITIES,
      },
      { ...errors, instance },
    );
    return {
      sessionInfo(session) {
        const result = port.sessionInfo(session);
        snapshots.push(result);
        return result;
      },
    };
  });
  const registry = new FlowRegistry(
    () => ({
      async start() {
        const flow = new FakeFlowPort(`pubkyauth://${CANARY}-${flows.length}`);
        flows.push(flow);
        return { ok: true, value: flow };
      },
      async resume() {
        throw new Error("This Session receiver fixture starts fresh flows");
      },
    }),
    {
      event: (event) => controller.dispatch(event),
      session: (id, session) => receive(id, session),
      diagnostic: diagnostics,
    },
    clock,
    errors,
  );
  let attempt = 0;
  const controller = new AttemptController(
    selection,
    () => ({ ...context, now: clock.now(), attemptId: `attempt-${++attempt}` }),
    {
      run(command) {
        commands.push(command);
        switch (command.type) {
          case "CreateFlow":
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
        }
      },
      dispose: () => registry.dispose(),
    },
    diagnostics,
    clock,
  );
  const receive = createSessionReceiver(controller, {
    adapter,
    capabilities: CAPABILITIES,
    normalize: validateCapabilities,
  });
  controller.onSession(delivered);
  controller.onSession((session) => transferred.add(session));
  controller.subscribe(states);
  const h = {
    controller,
    receive,
    registry,
    adapter,
    context,
    diagnostics,
    delivered,
    transferred,
    states,
    commands,
    flows,
    sessions,
    snapshots,
    clock,
    start: (instance = selection) =>
      startAttempt(controller, { type: "SIGN_IN", instance, popup: {} as Window }),
    async approve(fake: FakeSession, index = 0) {
      flows[index]!.settle(fake.session);
      await flush();
    },
    session(
      failure?: string,
      error: unknown = new Error(CANARY),
      signout?: (call: number) => Promise<void>,
    ) {
      const fake = new FakeSession(signout);
      sessions.push(fake);
      const calls = Object.fromEntries(
        ["info", "publicKey", "z32", "capabilities", "keyFree", "infoFree"].map((key) => [
          key,
          vi.fn(() => {
            if (failure === key) throw error;
          }),
        ]),
      ) as Record<string, Mock<() => void>>;
      const info = {
        get publicKey() {
          calls.publicKey!();
          return {
            z32: () => {
              calls.z32!();
              return "approved-key";
            },
            free: calls.keyFree,
          };
        },
        get capabilities() {
          calls.capabilities!();
          return [CAPABILITIES];
        },
        free: calls.infoFree,
      };
      Object.defineProperty(fake.session, "info", {
        configurable: true,
        get: () => {
          calls.info!();
          return info;
        },
      });
      return { fake, calls, info };
    },
  };
  resources.push(h);
  return h;
}

test("registers before a getter reenters, and never rereads or redispatches a delivered Session", async () => {
  const h = setup(CUSTOM);
  const result = h.start();
  await flush();
  const { fake, calls } = h.session();
  calls.info!.mockImplementation(() => {
    expect(calls.info).toHaveBeenCalledOnce();
    h.receive(1, fake.session);
  });
  await h.approve(fake);
  await expect(result).resolves.toMatchObject({
    status: "signed-in",
    session: fake.session,
    info: { publicKey: "approved-key" },
  });
  expect(h.controller.getState()).toMatchObject({ status: "signed-in", instance: CUSTOM });
  expect(h.delivered).toHaveBeenCalledOnce();
  expect(h.registry.instance(1)).toBeUndefined();
  expect(h.adapter).toHaveBeenCalledExactlyOnceWith(CUSTOM);
  expect(calls.keyFree).toHaveBeenCalledOnce();
  expect(calls.infoFree).toHaveBeenCalledOnce();
  const next = h.start(DEFAULT);
  const state = h.controller.getState();
  h.states.mockClear();
  h.receive(1, fake.session);
  expect(h.controller.getState()).toBe(state);
  expect(h.states).not.toHaveBeenCalled();
  expect(h.adapter).toHaveBeenCalledOnce();
  expect(h.diagnostics).not.toHaveBeenCalled();
  expect(fake.signouts).toBe(0);
  expect(fake.frees).toBe(0);
  h.controller.cancel();
  await expect(next).resolves.toMatchObject({ status: "failed", error: { code: "cancelled" } });
});

test.each([
  ["info", 0, 0],
  ["publicKey", 0, 1],
  ["z32", 1, 1],
  ["capabilities", 1, 1],
  ["keyFree", 1, 1],
  ["infoFree", 1, 1],
] as const)(
  "%s failure has no partial snapshot, uses pinned copy and cleans nested handles",
  async (stage, keyFrees, infoFrees) => {
    const h = setup(CUSTOM);
    const result = h.start();
    await flush();
    const { fake, calls } = h.session(
      stage,
      Object.assign(new Error(CANARY), { name: "PkarrError" }),
    );
    await h.approve(fake);
    const settled = await result;
    expect(settled).toMatchObject({
      status: "failed",
      error: {
        code: "internal",
        message: "Read failed for Inbox at custom.example; default default.example.",
        cause: { name: "PassportErrorCause", message: "PkarrError" },
      },
    });
    expect(h.controller.getState()).toMatchObject({ status: "failed", instance: CUSTOM });
    expect(h.commands.filter((command) => command.type === "EndAttempt")).toHaveLength(1);
    expect(h.commands.some((command) => command.type === "RetireFlow")).toBe(false);
    expect(h.delivered).not.toHaveBeenCalled();
    expect(fake.signouts).toBe(1);
    fake.assertFreed();
    expect(calls.keyFree).toHaveBeenCalledTimes(keyFrees);
    expect(calls.infoFree).toHaveBeenCalledTimes(infoFrees);
    expect(h.snapshots).toHaveLength(1);
    expect(h.snapshots[0]).not.toHaveProperty("value");
    expect(
      JSON.stringify([settled, h.controller.getState(), h.diagnostics.mock.calls]),
    ).not.toContain(CANARY);
    if (settled.status !== "failed") throw new Error("Expected metadata failure");
    expect(String(settled.error.cause)).not.toContain(CANARY);
    expect(settled.error.cause?.stack).not.toContain(CANARY);
  },
);

test("retries an unreadable Session revocation after two seconds, always frees and refuses the same object", async () => {
  const h = setup();
  const result = h.start();
  await flush();
  const { fake, calls } = h.session("z32", new Error(CANARY), async () => {
    throw new Error(CANARY);
  });
  await h.approve(fake);
  await expect(result).resolves.toMatchObject({ status: "failed", error: { code: "internal" } });
  h.receive(1, fake.session);
  h.clock.advance(1999);
  await flush();
  expect(fake.signouts).toBe(1);
  expect(fake.frees).toBe(0);
  h.clock.advance(1);
  await flush();
  expect(fake.signouts).toBe(2);
  fake.assertFreed();
  h.receive(1, fake.session);
  expect(calls.info).toHaveBeenCalledOnce();
  expect(h.adapter).toHaveBeenCalledOnce();
  expect(h.delivered).not.toHaveBeenCalled();
  expect(h.diagnostics.mock.calls).toEqual([[{ code: "revoke_failed" }]]);
});

test("retains the original flow pin after the registry releases a rotated custom flow", async () => {
  const h = setup(CUSTOM);
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await flush();
  h.controller.dispatch({ type: "RING_ROTATE" });
  await flush();
  const result = h.start(DEFAULT);
  await flush();
  const before = h.controller.getState();
  h.states.mockClear();
  const { fake } = h.session("info");
  await h.approve(fake, 0);
  expect(h.registry.instance(1)).toBeUndefined();
  expect(h.adapter).toHaveBeenLastCalledWith(CUSTOM);
  expect(h.snapshots.at(-1)).toMatchObject({
    ok: false,
    error: { message: "Read failed for Inbox at custom.example; default default.example." },
  });
  expect(h.controller.getState()).toBe(before);
  expect(h.states).not.toHaveBeenCalled();
  expect(h.delivered).not.toHaveBeenCalled();
  const approved = h.session().fake;
  await h.approve(approved, 2);
  await expect(result).resolves.toMatchObject({
    status: "signed-in",
    session: approved.session,
    info: { publicKey: "approved-key" },
  });
  expect(h.controller.getState()).toMatchObject({ status: "signed-in", instance: DEFAULT });
  expect(h.delivered).toHaveBeenCalledOnce();
});

test.each(["unknown", "cancelled", "superseded", "disposed"] as const)(
  "forwards duplicate-SDK metadata diagnostics without changing the %s authority rule",
  async (role) => {
    const h = setup();
    const pending = h.start();
    await flush();
    if (role === "cancelled") h.controller.cancel();
    if (role === "disposed") h.controller.dispose();
    if (role === "superseded") await h.approve(h.session().fake);
    const before = h.controller.getState();
    h.states.mockClear();
    h.delivered.mockClear();
    const { fake } = h.session("info", new Error(`expected instance of Session: ${CANARY}`));
    expect(() => h.receive(role === "unknown" ? 999 : 1, fake.session)).not.toThrow();
    await flush();
    expect(h.controller.getState()).toBe(before);
    expect(h.states).not.toHaveBeenCalled();
    expect(h.delivered).not.toHaveBeenCalled();
    expect(h.diagnostics.mock.calls[0]).toEqual([{ code: "sdk_duplicate_suspected" }]);
    expect(h.diagnostics.mock.calls[1]).toEqual([
      role === "superseded"
        ? { code: "duplicate_session_revoked", attemptId: "attempt-1" }
        : { code: "late_session_revoked" },
    ]);
    fake.assertFreed();
    expect(JSON.stringify([before, h.diagnostics.mock.calls])).not.toContain(CANARY);
    if (role === "unknown") {
      h.controller.cancel();
      await pending;
    }
  },
);

test.each(["/:rw", "/pub/elsewhere/:rw", "malformed"])(
  "a readable %s grant is revoked rather than authenticating",
  async (caps) => {
    const h = setup();
    const result = h.start();
    await flush();
    const { fake, info } = h.session();
    Object.defineProperty(info, "capabilities", { get: () => [caps] });
    await h.approve(fake);
    await expect(result).resolves.toMatchObject({
      status: "failed",
      error: { code: "capability_mismatch" },
    });
    expect(h.delivered).not.toHaveBeenCalled();
    expect(fake.signouts).toBe(1);
    fake.assertFreed();
  },
);

test.each([
  ["RequestError", "network"],
  ["PkarrError", "internal"],
  ["AuthenticationError", "internal"],
] as const)(
  "a factory %s is contained, mapped like start and keeps ownership",
  async (name, code) => {
    const h = setup(CUSTOM);
    const result = h.start();
    await flush();
    h.adapter.mockImplementationOnce(() => {
      throw Object.assign(new Error(CANARY), { name });
    });
    const { fake } = h.session();
    expect(() => h.receive(1, fake.session)).not.toThrow();
    await flush();
    const settled = await result;
    expect(settled).toMatchObject({
      status: "failed",
      error: { code, cause: { message: name } },
    });
    expect(h.delivered).not.toHaveBeenCalled();
    fake.assertFreed();
    expect(JSON.stringify(settled)).not.toContain(CANARY);
  },
);

test.each(["throw", "reject", "cancel"] as const)(
  "a %s diagnostic observer cannot strand the owned Session",
  async (mode) => {
    const h = setup();
    const result = h.start();
    await flush();
    h.diagnostics.mockImplementationOnce(() => {
      if (mode === "throw") throw new Error(CANARY);
      if (mode === "reject") return Promise.reject(new Error(CANARY));
      h.controller.cancel();
      return undefined;
    });

    const { fake } = h.session("info", new Error(`expected instance of Session: ${CANARY}`));
    await h.approve(fake);
    await expect(result).resolves.toMatchObject({
      status: "failed",
      error: { code: mode === "cancel" ? "cancelled" : "internal" },
    });
    expect(h.delivered).not.toHaveBeenCalled();
    expect(fake.signouts).toBe(1);
    fake.assertFreed();
  },
);

test("an unreadable ready-lease Session preserves its error and prepares again after the retry", async () => {
  const h = setup(CUSTOM);
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await flush();
  expect(h.controller.getState().status).toBe("ready");
  const { fake } = h.session("infoFree");
  await h.approve(fake);
  expect(h.controller.getState()).toMatchObject({
    status: "idle",
    instance: CUSTOM,
    lastError: {
      code: "internal",
      message: "Read failed for Inbox at custom.example; default default.example.",
    },
  });
  expect(h.delivered).not.toHaveBeenCalled();
  fake.assertFreed();
  h.clock.advance(4999);
  expect(h.flows).toHaveLength(1);
  h.clock.advance(1);
  await flush();
  expect(h.flows).toHaveLength(2);
  expect(h.controller.getState()).toMatchObject({
    status: "ready",
    lastError: { code: "internal" },
  });
});
