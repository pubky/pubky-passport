import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { systemClock } from "../shared/Clock.js";
import { AttemptTimers } from "./AttemptTimers.js";
import type { AttemptTimer } from "./attemptModel.js";

afterEach(() => {
  vi.useRealTimers();
});
const mappings = {
  ATTEMPT: "ATTEMPT_TIMEOUT",
  HANDSHAKE_HINT: "HANDSHAKE_HINT",
  CLOSED_GRACE: "CLOSED_GRACE",
  DETACHED: "DETACHED_TIMEOUT",
  FINISHING: "FINISHING_TIMEOUT",
  PROFILE_RECHECK: "PROFILE_RECHECK",
  PREPARE_RETRY: "PREPARE_RETRY",
  RING_ROTATE: "RING_ROTATE",
  RING_PIN_ELAPSED: "RING_PIN_ELAPSED",
  HIDDEN_CAP: "HIDDEN_CAP",
  LEASE_IDLE: "LEASE_IDLE",
} as const satisfies Record<AttemptTimer, string>;

test.each(Object.entries(mappings) as [AttemptTimer, string][])(
  "%s emits %s once at its deadline",
  (timer, type) => {
    const clock = new FakeClock();
    const receive = vi.fn();
    const timers = new AttemptTimers(receive, clock);
    timers.set(timer, 100);
    clock.advance(99);
    expect(receive).not.toHaveBeenCalled();
    clock.advance(1);
    expect(receive).toHaveBeenCalledExactlyOnceWith({ type });
    clock.captured[0]!();
    expect(receive).toHaveBeenCalledOnce();
    timers.dispose();
    clock.assertEmpty();
  },
);

test("replacement and clear reject callbacks already queued by the environment", () => {
  const clock = new FakeClock();
  const receive = vi.fn();
  const timers = new AttemptTimers(receive, clock);
  timers.set("ATTEMPT", 10);
  const old = clock.captured[0]!;
  timers.set("ATTEMPT", 20);
  old();
  expect(receive).not.toHaveBeenCalled();
  timers.clear(["ATTEMPT", "ATTEMPT"]);
  clock.captured[1]!();
  expect(receive).not.toHaveBeenCalled();
  timers.dispose();
  clock.assertEmpty();
});

test("a fired timer can immediately schedule its next generation", () => {
  const clock = new FakeClock();
  const receive = vi.fn(() => {
    timers.set("RING_ROTATE", 10);
  });
  const timers = new AttemptTimers(receive, clock);
  timers.set("RING_ROTATE", 10);
  clock.advance(20);
  expect(receive).toHaveBeenCalledTimes(2);
  timers.dispose();
  for (const callback of clock.captured) callback();
  expect(receive).toHaveBeenCalledTimes(2);
  timers.set("ATTEMPT", 1);
  clock.assertEmpty();
});

test("clearAll isolates one timer owner from another", () => {
  const clock = new FakeClock();
  const first = vi.fn();
  const second = vi.fn();
  const a = new AttemptTimers(first, clock);
  const b = new AttemptTimers(second, clock);
  a.set("ATTEMPT", 1);
  a.set("FINISHING", 1);
  b.set("ATTEMPT", 1);
  a.clearAll();
  clock.advance(1);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  a.dispose();
  b.dispose();
  clock.assertEmpty();
});

test("a scheduler failure removes its registration and can be retried", () => {
  const clock = new FakeClock();
  const receive = vi.fn();
  const failing = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error("scheduler failed");
    })
    .mockImplementation(clock.schedule.bind(clock));
  const timers = new AttemptTimers(receive, { now: clock.now, schedule: failing });
  expect(() => timers.set("ATTEMPT", 1)).toThrow("scheduler failed");
  timers.set("ATTEMPT", 1);
  clock.advance(1);
  expect(receive).toHaveBeenCalledOnce();
  timers.dispose();
  clock.assertEmpty();
});

test("one failing canceller does not prevent other cleanup or admit its stale callback", () => {
  const clock = new FakeClock();
  const receive = vi.fn();
  const timers = new AttemptTimers(receive, {
    now: clock.now,
    schedule(callback, ms) {
      const cancel = clock.schedule(callback, ms);
      return () => {
        cancel();
        throw new Error("cancel failed");
      };
    },
  });
  timers.set("ATTEMPT", 1);
  timers.set("HANDSHAKE_HINT", 1);
  timers.dispose();
  timers.dispose();
  for (const callback of clock.captured) callback();
  expect(receive).not.toHaveBeenCalled();
  clock.assertEmpty();
});

test("synchronous injected delivery cannot leave a registration behind", () => {
  const cancel = vi.fn();
  const receive = vi.fn();
  const timers = new AttemptTimers(receive, {
    now: () => 0,
    schedule(callback) {
      callback();
      return cancel;
    },
  });
  timers.set("ATTEMPT", 1);
  expect(receive).toHaveBeenCalledOnce();
  timers.dispose();
  expect(cancel).toHaveBeenCalledOnce();
});

test("systemClock reads the timer functions only when scheduled and cancels the exact handle", () => {
  vi.useFakeTimers();
  const schedule = vi.spyOn(globalThis, "setTimeout");
  const unschedule = vi.spyOn(globalThis, "clearTimeout");
  const receive = vi.fn();
  const start = systemClock.now();
  const cancel = systemClock.schedule(receive, 100);
  expect(schedule).toHaveBeenCalledExactlyOnceWith(receive, 100);
  vi.advanceTimersByTime(99);
  expect(receive).not.toHaveBeenCalled();
  cancel();
  expect(unschedule).toHaveBeenCalledExactlyOnceWith(schedule.mock.results[0]!.value);
  vi.advanceTimersByTime(1);
  expect(receive).not.toHaveBeenCalled();
  expect(systemClock.now()).toBe(start + 100);
});
