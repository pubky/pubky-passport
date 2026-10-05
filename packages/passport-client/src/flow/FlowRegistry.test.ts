import type { Session } from "@synonymdev/pubky";
import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import { mapSdkError } from "../errors/mapSdkError.js";
import type { FlowHandle, FlowResult } from "./FlowPort.js";
import { FlowRegistry } from "./FlowRegistry.js";

const INSTANCE = {
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
};
const CANARY = ["registry", "private", "payload"].join("-");
const resources: { flow: FakeFlowPort; clock: FakeClock }[] = [];
const sessions: FakeSession[] = [];
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
afterEach(() => {
  for (const { flow, clock } of resources.splice(0)) {
    flow.assertFreed();
    clock.assertEmpty();
  }
  for (const fake of sessions.splice(0)) fake.assertFreed();
});
function setup() {
  const flow = new FakeFlowPort("pubkyauth://" + CANARY);
  const clock = new FakeClock();
  resources.push({ flow, clock });
  let resolve!: (result: FlowResult<FlowHandle>) => void;
  let reject!: (error: unknown) => void;
  const pending = new Promise<FlowResult<FlowHandle>>((a, b) => {
    resolve = a;
    reject = b;
  });
  const port = { start: vi.fn(() => pending), resume: vi.fn(() => pending) };
  const factory = vi.fn(() => port);
  const received: Session[] = [];
  const observer = {
    event: vi.fn(),
    diagnostic: vi.fn(),
    session: vi.fn((_id: number, value: Session) => {
      received.push(value);
    }),
  };
  const registry = new FlowRegistry(factory, observer, clock);
  return { registry, flow, clock, observer, received, port, factory, resolve, reject };
}
test("creation uses its pinned instance, emits only a redacted link, and starts one commanded poll", async () => {
  const h = setup();
  h.registry.create(1, INSTANCE);
  h.registry.create(1, INSTANCE);
  expect(h.port.start).toHaveBeenCalledExactlyOnceWith(undefined);
  h.resolve({ ok: true, value: h.flow });
  await flush();
  expect(h.factory).toHaveBeenCalledExactlyOnceWith(INSTANCE);
  const event = h.observer.event.mock.calls[0]![0];
  expect(event).toMatchObject({ type: "FLOW_CREATED", flowId: 1 });
  expect(JSON.stringify(event)).not.toContain(CANARY);
  expect(event.ringLink.reveal()).toBe(h.flow.url);
  expect(JSON.stringify(h.registry)).not.toContain(CANARY);
  expect(h.flow.polls).toBe(0);
  h.registry.start(1);
  h.registry.start(1);
  expect(h.flow.polls).toBe(1);
  h.registry.free(1);
  expect(event.ringLink.reveal()).toBeUndefined();
  h.flow.settle();
  await flush();
  expect(h.registry.authorizationUrl(1)).toBeUndefined();
  h.registry.create(1, INSTANCE);
  expect(h.port.start).toHaveBeenCalledOnce();
});

test.each(["free", "dispose"] as const)(
  "%s while creation is pending frees the orphan without inspecting or polling it",
  async (method) => {
    const h = setup();
    h.registry.create(1, INSTANCE);
    if (method === "free") h.registry.free(1);
    else h.registry.dispose();
    h.resolve({ ok: true, value: h.flow });
    await flush();
    expect(h.flow.reads).toBe(0);
    expect(h.flow.polls).toBe(0);
    expect(h.observer.event).not.toHaveBeenCalled();
  },
);

test("resume passes the delegated state once and emits RESUMED without polling", async () => {
  const h = setup();
  h.registry.resume(1, INSTANCE, CANARY);
  expect(h.port.resume).toHaveBeenCalledExactlyOnceWith(CANARY);
  h.resolve({ ok: true, value: h.flow });
  await flush();
  expect(h.observer.event).toHaveBeenCalledExactlyOnceWith({ type: "RESUMED", flowId: 1 });
  expect(h.registry.save(1)).toEqual({ ok: true, value: "delegated:" + h.flow.url });
  expect(h.flow.polls).toBe(0);
  h.registry.dispose();
});

test.each(["create", "resume"] as const)(
  "%s failure is safe and a rejected adapter promise is contained",
  async (mode) => {
    const h = setup();
    if (mode === "create") h.registry.create(1, INSTANCE);
    else h.registry.resume(1, INSTANCE, CANARY);
    h.reject(Object.assign(new Error(CANARY), { name: "RequestError" }));
    await flush();
    expect(h.observer.event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: mode === "create" ? "FLOW_FAILED" : "RESUME_FAILED",
        flowId: 1,
      }),
    );
    expect(JSON.stringify(h.observer.event.mock.calls)).not.toContain(CANARY);
    if (mode === "create") expect(h.observer.event.mock.calls[0]![0].error.code).toBe("network");
    h.flow.free();
    h.registry.dispose();
  },
);

test("a mapped adapter failure preserves error identity and emits only its enumerated diagnostic", async () => {
  const h = setup();
  h.registry.create(1, INSTANCE);
  const failure = mapSdkError(new Error("expected instance of AuthFlowKind"), "start");
  h.resolve({ ok: false, ...failure });
  await flush();
  expect(h.observer.event).toHaveBeenCalledExactlyOnceWith({
    type: "FLOW_FAILED",
    flowId: 1,
    error: failure.error,
  });
  expect(h.observer.diagnostic).toHaveBeenCalledExactlyOnceWith({
    code: "sdk_duplicate_suspected",
  });
  h.flow.free();
  h.registry.dispose();
});

test("the initial URL getter failure cannot publish a ready link", async () => {
  const h = setup();
  h.flow.urlError = new Error(CANARY);
  h.registry.create(1, INSTANCE);
  h.resolve({ ok: true, value: h.flow });
  await flush();
  expect(h.observer.event).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ type: "FLOW_FAILED", flowId: 1 }),
  );
  expect(JSON.stringify(h.observer.event.mock.calls)).not.toContain(CANARY);
  h.registry.dispose();
});

test("retirement invalidates links immediately and later removes the freed handle", async () => {
  const h = setup();
  h.registry.create(1, INSTANCE);
  h.resolve({ ok: true, value: h.flow });
  await flush();
  const link = h.observer.event.mock.calls[0]![0].ringLink;
  h.registry.retire(1, 100);
  expect(link.reveal()).toBeUndefined();
  h.clock.advance(100);
  h.flow.settle();
  await flush();
  h.registry.start(1);
  h.registry.retire(1, 100);
  h.registry.dispose();
  expect(h.flow.polls).toBe(1);
  expect(h.registry.save(1)).toMatchObject({ ok: false });
});

test("a late Session retains its original flow ID after registry disposal", async () => {
  const h = setup();
  const fake = new FakeSession();
  sessions.push(fake);
  h.registry.create(1, INSTANCE);
  h.resolve({ ok: true, value: h.flow });
  await flush();
  h.registry.start(1);
  h.registry.dispose();
  h.registry.dispose();
  h.flow.settle(fake.session);
  await flush();
  expect(h.observer.session).toHaveBeenCalledExactlyOnceWith(1, fake.session);
  expect(h.received).toEqual([fake.session]);
  fake.session.free();
  h.registry.create(2, INSTANCE);
  expect(h.port.start).toHaveBeenCalledOnce();
});

test("a poll error keeps its pin and override context after creation", async () => {
  const h = setup();
  const registry = new FlowRegistry(h.factory, h.observer, h.clock, {
    messages: {
      "error.network": (context) => `Cannot reach ${context.instanceHost} for ${context.appName}`,
    },
    context: { appName: "Example" },
  });
  registry.create(1, INSTANCE);
  h.resolve({ ok: true, value: h.flow });
  await flush();
  registry.start(1);
  h.flow.fail(Object.assign(new Error(CANARY), { name: "RequestError" }));
  await flush();
  expect(h.observer.event).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "POLL_FAILED",
      flowId: 1,
      error: expect.objectContaining({ message: "Cannot reach custom.example for Example" }),
    }),
  );
  registry.free(1);
});

test("an internal event sink failure releases an otherwise unclaimed created flow", async () => {
  const h = setup();
  h.observer.event.mockImplementation(() => {
    throw new Error(CANARY);
  });
  h.registry.create(1, INSTANCE);
  h.resolve({ ok: true, value: h.flow });
  await flush();
  h.registry.dispose();
});

test.each(["handle", "throwing free", "rejection"])(
  "a disposed pending resume cleans up its late %s without dispatching",
  async (outcome) => {
    const h = setup();
    h.registry.resume(1, INSTANCE, CANARY);
    h.registry.dispose();
    if (outcome === "rejection") {
      h.reject(new Error(CANARY));
      h.flow.free(); // The failed fake operation never returned this test allocation.
    } else {
      if (outcome === "throwing free") h.flow.freeError = new Error(CANARY);
      h.resolve({ ok: true, value: h.flow });
    }
    await flush();
    expect(h.observer.event).not.toHaveBeenCalled();
    expect(h.observer.diagnostic).not.toHaveBeenCalled();
    expect(h.flow.reads).toBe(0);
    expect(h.flow.polls).toBe(0);
  },
);
