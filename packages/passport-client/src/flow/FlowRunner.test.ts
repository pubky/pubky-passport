import type { Session } from "@synonymdev/pubky";
import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import { EMPTY_POLL_MS, FlowRunner, HIDDEN_POLL_MS } from "./FlowRunner.js";

const CANARY = ["flow", "private", "payload"].join("-");
const cases: { flow: FakeFlowPort; clock: FakeClock }[] = [];
const sessions: FakeSession[] = [];
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => {
  for (const { flow, clock } of cases.splice(0)) {
    flow.assertFreed();
    clock.assertEmpty();
  }
  for (const session of sessions.splice(0)) session.assertFreed();
});
function setup(flow = new FakeFlowPort(), visible?: () => boolean) {
  const clock = new FakeClock();
  const received: Session[] = [];
  const session = vi.fn((value: Session) => {
    received.push(value);
  });
  const failure = vi.fn();
  const runner = new FlowRunner(flow, { session, failure }, clock, {}, visible);
  cases.push({ flow, clock });
  return { flow, clock, runner, received, session, failure };
}
function session() {
  const fake = new FakeSession();
  sessions.push(fake);
  return fake;
}

test("repeated start maintains one in-flight poll and paces empty responses", async () => {
  const h = setup();
  h.runner.start();
  h.runner.start();
  expect(h.flow.polls).toBe(1);
  h.flow.settle();
  await flush();
  expect(h.flow.polls).toBe(1);
  expect(h.clock.pending.size).toBe(1);
  // No hot loop: the next look waits, and still comes well within half a second.
  expect(EMPTY_POLL_MS).toBeLessThanOrEqual(300);
  h.clock.advance(EMPTY_POLL_MS - 1);
  expect(h.flow.polls).toBe(1);
  h.clock.advance(1);
  expect(h.flow.polls).toBe(2);
  h.runner.free();
  h.flow.settle();
  await flush();
  expect(h.session).not.toHaveBeenCalled();
  expect(h.failure).not.toHaveBeenCalled();
});

const PACES: [string, () => boolean, number][] = [
  ["hidden", () => false, HIDDEN_POLL_MS],
  ["in view again", () => true, EMPTY_POLL_MS],
  [
    "unknown",
    () => {
      throw new Error("no document");
    },
    EMPTY_POLL_MS,
  ],
];
test.each(PACES)(
  "a page that is %s looks again after its own pause",
  async (_name, visible, pause) => {
    const h = setup(new FakeFlowPort(), visible);
    h.runner.start();
    for (let poll = 1; poll <= 3; poll++) {
      expect(h.flow.polls).toBe(poll);
      h.flow.settle();
      await flush();
      h.clock.advance(pause - 1);
      expect(h.flow.polls).toBe(poll);
      h.clock.advance(1);
    }
    h.runner.free();
    h.flow.settle();
    await flush();
  },
);

test("an answer is picked up by the next paced look, an empty reply never spins", async () => {
  const h = setup();
  h.runner.start();
  for (let i = 0; i < 5; i++) {
    h.flow.settle();
    await flush();
    // One timer, never a poll that starts without waiting.
    expect(h.clock.pending.size).toBe(1);
    h.clock.advance(EMPTY_POLL_MS);
  }
  expect(h.flow.polls).toBe(6);
  const fake = session();
  h.flow.settle(fake.session);
  await flush();
  expect(h.received).toEqual([fake.session]);
  fake.session.free();
});

test("a Session stops polling, frees the flow and transfers its exact handle once", async () => {
  const h = setup();
  const fake = session();
  h.runner.start();
  h.flow.settle(fake.session);
  await flush();
  expect(h.received).toEqual([fake.session]);
  expect(h.flow.frees).toBe(1);
  h.runner.start();
  h.runner.retire(100);
  h.clock.advance(100);
  h.runner.free();
  expect(h.flow.polls).toBe(1);
  expect(h.runner.authorizationUrl).toBeUndefined();
  fake.session.free();
});

test.each(["empty", "Session", "error"] as const)(
  "free during a poll waits for %s and never drops a late Session",
  async (result) => {
    const h = setup();
    h.runner.start();
    h.runner.free();
    h.runner.free();
    expect(h.flow.frees).toBe(0);
    expect(h.runner.authorizationUrl).toBeUndefined();
    if (result === "error") h.flow.fail(Object.assign(new Error(CANARY), { name: "RequestError" }));
    else if (result === "Session") {
      const fake = session();
      h.flow.settle(fake.session);
    } else h.flow.settle();
    await flush();
    expect(h.flow.frees).toBe(1);
    expect(h.received).toHaveLength(result === "Session" ? 1 : 0);
    for (const value of h.received) value.free();
    expect(JSON.stringify(h.failure.mock.calls)).not.toContain(CANARY);
  },
);

test("free cancels a queued poll and invalidates any stale callback", async () => {
  const h = setup();
  h.runner.start();
  h.flow.settle();
  await flush();
  const stale = h.clock.captured[0]!;
  h.runner.free();
  stale();
  h.runner.start();
  expect(h.flow.polls).toBe(1);
  expect(h.flow.frees).toBe(1);
});

test("retirement polls through its grace and repeats do not extend the deadline", async () => {
  const h = setup();
  h.runner.retire(1000);
  expect(h.flow.polls).toBe(1);
  expect(h.runner.authorizationUrl).toBeUndefined();
  h.clock.advance(500);
  h.runner.retire(1000);
  h.flow.settle();
  await flush();
  h.clock.advance(EMPTY_POLL_MS);
  expect(h.flow.polls).toBe(2);
  h.clock.advance(1000 - 500 - EMPTY_POLL_MS - 1);
  expect(h.flow.frees).toBe(0);
  h.clock.advance(1);
  expect(h.flow.frees).toBe(0);
  h.flow.settle();
  await flush();
  expect(h.flow.polls).toBe(2);
  expect(h.flow.frees).toBe(1);
});

test("a Session after the drain deadline is still handed to the model's ownership sink", async () => {
  const h = setup();
  const fake = session();
  h.runner.start();
  h.runner.retire(100);
  h.clock.advance(100);
  expect(h.flow.frees).toBe(0);
  h.flow.settle(fake.session);
  await flush();
  expect(h.received).toEqual([fake.session]);
  fake.session.free();
});

test("a Session inside the drain grace cancels its deadline", async () => {
  const h = setup();
  const fake = session();
  h.runner.retire(100);
  h.flow.settle(fake.session);
  await flush();
  expect(h.received).toEqual([fake.session]);
  h.clock.assertEmpty();
  fake.session.free();
});

test("authorizationUrl is cached before polling and never read through a borrowed handle", async () => {
  const h = setup();
  expect(h.runner.authorizationUrl).toBe(h.flow.url);
  h.runner.start();
  expect(h.runner.authorizationUrl).toBe(h.flow.url);
  expect(h.flow.reads).toBe(1);
  expect(JSON.stringify(h.runner)).not.toContain(CANARY);
  h.runner.free();
  h.flow.settle();
  await flush();
});

test("the delegated save uses an unpolled handle and contains errors", () => {
  const h = setup();
  expect(h.runner.save()).toEqual({ ok: true, value: "delegated:" + h.flow.url });
  h.flow.saveError = new Error(CANARY);
  const result = h.runner.save();
  expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
  expect(JSON.stringify(result)).not.toContain(CANARY);
  h.runner.free();
});

test("save is refused while polling, after retirement and after free without touching the handle", async () => {
  const h = setup();
  h.runner.start();
  expect(h.runner.save()).toMatchObject({ ok: false });
  h.flow.settle();
  await flush();
  expect(h.runner.save()).toMatchObject({ ok: false });
  h.runner.retire(100);
  expect(h.runner.save()).toMatchObject({ ok: false });
  h.runner.free();
  expect(h.runner.save()).toMatchObject({ ok: false });
  expect(h.flow.saves).toBe(0);
});

test.each(["RequestError", "PkarrError", "AuthenticationError", "ClientStateError"])(
  "a %s poll failure is mapped once and pauses until a command",
  async (name) => {
    const h = setup();
    h.runner.start();
    h.flow.fail(Object.assign(new Error(CANARY), { name }));
    await flush();
    const code = {
      RequestError: "network",
      PkarrError: "identity_unresolved",
      AuthenticationError: "approval_rejected",
      ClientStateError: "internal",
    }[name];
    expect(h.failure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ error: expect.objectContaining({ code }) }),
    );
    expect(JSON.stringify(h.failure.mock.calls)).not.toContain(CANARY);
    h.clock.assertEmpty();
    h.runner.free();
  },
);

test("a failure callback can retire and restart without the old poll overwriting its flags", async () => {
  const h = setup();
  h.failure.mockImplementationOnce(() => {
    h.runner.retire(1000);
  });
  h.runner.start();
  h.flow.fail(new Error(CANARY));
  await flush();
  expect(h.flow.polls).toBe(2);
  h.flow.settle();
  await flush();
  h.clock.advance(EMPTY_POLL_MS);
  expect(h.flow.polls).toBe(3);
  h.runner.free();
  h.flow.settle();
  await flush();
});

test("a failed initial URL read frees the owned handle and reports a sanitized start failure", () => {
  const flow = new FakeFlowPort();
  flow.urlError = new Error(CANARY);
  const h = setup(flow);
  h.runner.start();
  h.runner.start();
  expect(h.failure).toHaveBeenCalledOnce();
  expect(h.failure).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.objectContaining({ code: "internal" }) }),
  );
  expect(JSON.stringify(h.failure.mock.calls)).not.toContain(CANARY);
  expect(flow.polls).toBe(0);
});

test("a throwing scheduler produces a mapped failure and leaves the flow available for cleanup", async () => {
  const h = setup();
  vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error(CANARY);
  });
  h.runner.start();
  h.flow.settle();
  await flush();
  expect(h.failure).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ error: expect.objectContaining({ code: "internal" }) }),
  );
  h.runner.free();
});

test("an internal sink takes Session ownership even if its later processing throws", async () => {
  const h = setup();
  const fake = session();
  h.session.mockImplementation((value) => {
    h.received.push(value);
    throw new Error(CANARY);
  });
  h.runner.start();
  h.flow.settle(fake.session);
  await flush();
  expect(h.received).toEqual([fake.session]);
  expect(h.flow.frees).toBe(1);
  expect(h.failure).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.objectContaining({ code: "internal" }) }),
  );
  fake.session.free();
});

test("failure observer and native free exceptions cannot cause a second free or an unhandled rejection", async () => {
  const h = setup();
  h.failure.mockImplementation(() => {
    throw new Error(CANARY);
  });
  h.flow.freeError = new Error(CANARY);
  h.runner.start();
  h.flow.fail(new Error(CANARY));
  await flush();
  h.runner.free();
  h.runner.free();
  expect(h.flow.frees).toBe(1);
});

test("retirement scheduler failure waits for a borrowed poll and still delivers its Session", async () => {
  const h = setup();
  const fake = session();
  h.runner.start();
  vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error(CANARY);
  });
  h.runner.retire(100);
  expect(h.flow.frees).toBe(0);
  expect(h.failure).toHaveBeenCalledOnce();
  h.flow.settle(fake.session);
  await flush();
  expect(h.received).toEqual([fake.session]);
  fake.session.free();
});

test("a synchronous native poll throw is contained and leaves cleanup available", async () => {
  const h = setup();
  vi.spyOn(h.flow, "tryPollOnce").mockImplementation(() => {
    throw new Error(CANARY);
  });
  h.runner.start();
  await flush();
  expect(h.failure).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.failure.mock.calls)).not.toContain(CANARY);
  h.runner.free();
});

test("asynchronous internal observer failures are contained after ownership transfers", async () => {
  const h = setup();
  const fake = session();
  h.session.mockImplementation(async (value) => {
    h.received.push(value);
    throw new Error(CANARY);
  });
  h.failure.mockRejectedValue(new Error(CANARY));
  h.runner.start();
  h.flow.settle(fake.session);
  await flush();
  expect(h.received).toEqual([fake.session]);
  expect(h.failure).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.failure.mock.calls)).not.toContain(CANARY);
  fake.session.free();
});

test.each([false, true])(
  "the freed observer runs once after settlement and contains its own failure (async=%s)",
  async (asyncThrow) => {
    const flow = new FakeFlowPort();
    const clock = new FakeClock();
    cases.push({ flow, clock });
    const freed = vi.fn(() => {
      flow.assertFreed();
      if (asyncThrow) return Promise.reject(new Error(CANARY));
      throw new Error(CANARY);
    });
    const runner = new FlowRunner(flow, { session: vi.fn(), failure: vi.fn(), freed }, clock);
    runner.start();
    runner.free();
    expect(freed).not.toHaveBeenCalled();
    flow.settle();
    await flush();
    runner.free();
    expect(freed).toHaveBeenCalledOnce();
  },
);
