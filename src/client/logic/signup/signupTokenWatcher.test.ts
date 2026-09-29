import { describe, expect, it, vi } from "vitest";

import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import {
  SIGNUP_TOKEN_WATCH_INTERVAL_MS,
  SIGNUP_TOKEN_WATCH_MAX_INTERVAL_MS,
  watchSignupToken,
} from "./signupTokenWatcher";

const INVITE = {
  homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
  signupToken: "R1NG-5GNP-QW7X",
};

/** Holds scheduled lookups so a test runs them one at a time. */
function manualScheduler() {
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  const schedule = (run: () => void, delayMs: number) => {
    const timer = { run, delayMs, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const next = async () => {
    const timer = timers.at(-1);
    if (!timer || timer.cancelled) throw new Error("No lookup is scheduled.");
    timer.run();
    await vi.waitFor(() => undefined);
  };
  return { schedule, timers, next };
}

describe("watchSignupToken", () => {
  it("looks the invite up every few seconds until the homeserver reports it used", async () => {
    const answers: SignupTokenStatus[] = ["valid", "not_found", "valid", "used"];
    const check = vi.fn(async () => answers.shift() ?? "used");
    const onUsed = vi.fn();
    const scheduler = manualScheduler();
    watchSignupToken(INVITE, check, onUsed, { schedule: scheduler.schedule });

    // Nothing is asked at once: Ring needs time to scan and sign up.
    expect(check).not.toHaveBeenCalled();
    for (let lookup = 1; lookup <= 3; lookup++) {
      await scheduler.next();
      expect(check).toHaveBeenCalledTimes(lookup);
      expect(onUsed).not.toHaveBeenCalled();
    }
    await scheduler.next();
    expect(onUsed).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
    expect(
      scheduler.timers.every((timer) => timer.delayMs === SIGNUP_TOKEN_WATCH_INTERVAL_MS),
    ).toBe(true);
    // Once used, nothing more is scheduled.
    expect(scheduler.timers).toHaveLength(4);
  });

  it("waits longer after each lookup that got no answer, and returns to the pace after one", async () => {
    const answers: SignupTokenStatus[] = [
      ...Array<SignupTokenStatus>(6).fill("unknown"),
      "valid",
      "unknown",
    ];
    const check = vi.fn(async () => answers.shift() ?? "valid");
    const scheduler = manualScheduler();
    watchSignupToken(INVITE, check, vi.fn(), { schedule: scheduler.schedule });

    for (let lookup = 0; lookup < 8; lookup++) await scheduler.next();
    // An unreachable homeserver is asked, and its failure logged, ever more rarely, capped.
    expect(scheduler.timers.map((timer) => timer.delayMs)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 30_000, 30_000, 3_000, 6_000,
    ]);
    expect(SIGNUP_TOKEN_WATCH_MAX_INTERVAL_MS).toBe(30_000);
  });

  it("stops watching, and ignores a lookup still under way, once stopped", async () => {
    let answer!: (status: SignupTokenStatus) => void;
    const check = vi.fn<(invite: typeof INVITE, signal: AbortSignal) => Promise<SignupTokenStatus>>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const onUsed = vi.fn();
    const scheduler = manualScheduler();
    const stop = watchSignupToken(INVITE, check, onUsed, { schedule: scheduler.schedule });

    await scheduler.next();
    stop();
    expect(check.mock.calls[0]?.[1].aborted).toBe(true);
    answer("used");
    await vi.waitFor(() => undefined);
    expect(onUsed).not.toHaveBeenCalled();
    expect(scheduler.timers).toHaveLength(1);
  });

  it("cancels the first lookup when stopped before it runs", () => {
    const scheduler = manualScheduler();
    const stop = watchSignupToken(INVITE, vi.fn(), vi.fn(), { schedule: scheduler.schedule });
    stop();
    expect(scheduler.timers[0]?.cancelled).toBe(true);
  });

  it("schedules with real timers by default", async () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(async (): Promise<SignupTokenStatus> => "used");
      const onUsed = vi.fn();
      watchSignupToken(INVITE, check, onUsed);
      await vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS);
      expect(onUsed).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
