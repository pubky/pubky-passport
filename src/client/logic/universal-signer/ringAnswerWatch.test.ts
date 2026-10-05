/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { type PageVisibility, type RingAnswerLook, watchForRingAnswer } from "./ringAnswerWatch";

const PACE = { intervalMs: 3_000, maxIntervalMs: 30_000 };

/** Holds scheduled looks so a test runs them one at a time. */
function manualScheduler() {
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  const schedule = (run: () => void, delayMs: number) => {
    const timer = { run, delayMs, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const pending = () => timers.filter((timer) => !timer.cancelled && timer.delayMs >= 0);
  const next = async () => {
    const timer = timers.at(-1);
    if (!timer || timer.cancelled) throw new Error("No look is scheduled.");
    timer.cancelled = true;
    timer.run();
    await vi.waitFor(() => undefined);
  };
  return { schedule, timers, pending, next };
}

/** A page whose visibility the test switches. */
function fakePage(visible = true) {
  const listeners = new Set<() => void>();
  const page: PageVisibility = {
    isVisible: () => visible,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const show = async (next: boolean) => {
    visible = next;
    for (const listener of listeners) listener();
    await vi.waitFor(() => undefined);
  };
  return { page, show, listeners };
}

describe("watchForRingAnswer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("looks after each interval until the answer is there, then stops", async () => {
    const answers: RingAnswerLook[] = ["waiting", "waiting", "answered"];
    const look = vi.fn(async () => answers.shift() ?? "answered");
    const onAnswered = vi.fn();
    const scheduler = manualScheduler();
    const { page, listeners } = fakePage();
    watchForRingAnswer(look, onAnswered, PACE, { page, schedule: scheduler.schedule });

    // Nothing is asked at once: Ring needs time to be used.
    expect(look).not.toHaveBeenCalled();
    await scheduler.next();
    await scheduler.next();
    expect(onAnswered).not.toHaveBeenCalled();
    await scheduler.next();
    expect(onAnswered).toHaveBeenCalledOnce();
    expect(look).toHaveBeenCalledTimes(3);
    expect(scheduler.timers.map((timer) => timer.delayMs)).toEqual([3_000, 3_000, 3_000]);
    // Answered: nothing more is scheduled and the page is no longer followed.
    expect(scheduler.pending()).toEqual([]);
    expect(listeners.size).toBe(0);
  });

  it("backs off while the server gives no usable reply, a throw included, and recovers", async () => {
    const answers: RingAnswerLook[] = ["unreachable", "unreachable", "unreachable", "unreachable"];
    const look = vi.fn(async (): Promise<RingAnswerLook> => {
      const answer = answers.shift();
      if (answer === undefined) return "waiting";
      if (answers.length === 1) throw new Error("network");
      return answer;
    });
    const scheduler = manualScheduler();
    watchForRingAnswer(look, vi.fn(), PACE, {
      page: fakePage().page,
      schedule: scheduler.schedule,
    });

    for (let lookup = 0; lookup < 6; lookup++) await scheduler.next();
    expect(scheduler.timers.map((timer) => timer.delayMs)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 3_000, 3_000,
    ]);
  });

  it("pauses while the page is hidden and looks at once when it is shown again", async () => {
    const look = vi.fn(async (): Promise<RingAnswerLook> => "waiting");
    const scheduler = manualScheduler();
    const visibility = fakePage();
    watchForRingAnswer(look, vi.fn(), PACE, {
      page: visibility.page,
      schedule: scheduler.schedule,
    });

    await visibility.show(false);
    // The pending look is cancelled and none is scheduled while hidden.
    expect(scheduler.pending()).toEqual([]);
    expect(look).not.toHaveBeenCalled();

    await visibility.show(true);
    expect(look).toHaveBeenCalledOnce();
    expect(scheduler.pending().map((timer) => timer.delayMs)).toEqual([3_000]);
  });

  it("does not start looking on a hidden page until it is shown", async () => {
    const look = vi.fn(async (): Promise<RingAnswerLook> => "answered");
    const onAnswered = vi.fn();
    const scheduler = manualScheduler();
    const visibility = fakePage(false);
    watchForRingAnswer(look, onAnswered, PACE, {
      page: visibility.page,
      schedule: scheduler.schedule,
    });

    expect(scheduler.timers).toEqual([]);
    await visibility.show(true);
    expect(onAnswered).toHaveBeenCalledOnce();
  });

  it("stops on leave: aborts a look under way and ignores its answer", async () => {
    let answer!: (look: RingAnswerLook) => void;
    const look = vi.fn<(signal: AbortSignal) => Promise<RingAnswerLook>>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const onAnswered = vi.fn();
    const scheduler = manualScheduler();
    const visibility = fakePage();
    const stop = watchForRingAnswer(look, onAnswered, PACE, {
      page: visibility.page,
      schedule: scheduler.schedule,
    });

    await scheduler.next();
    stop();
    expect(look.mock.calls[0]?.[0].aborted).toBe(true);
    answer("answered");
    await vi.waitFor(() => undefined);
    expect(onAnswered).not.toHaveBeenCalled();
    expect(visibility.listeners.size).toBe(0);
    await visibility.show(true);
    expect(look).toHaveBeenCalledOnce();
  });

  it("follows the document's visibility and real timers by default", async () => {
    vi.useFakeTimers();
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    setVisibility("visible");
    const look = vi.fn(async (): Promise<RingAnswerLook> => "waiting");
    const stop = watchForRingAnswer(look, vi.fn(), PACE);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(look).not.toHaveBeenCalled();
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(look).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(look).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(look).toHaveBeenCalledTimes(2);
  });
});
