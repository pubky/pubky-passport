import { systemClock, type Clock } from "../shared/Clock.js";
import type { AttemptEvent, AttemptTimer } from "./attemptModel.js";

const EVENTS = {
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
} as const satisfies Record<AttemptTimer, AttemptEvent["type"]>;

interface Registration {
  cancel: () => void;
}

export class AttemptTimers {
  private readonly pending = new Map<AttemptTimer, Registration>();
  private disposed = false;
  constructor(
    private readonly dispatch: (event: AttemptEvent) => void,
    private readonly clock: Clock = systemClock,
  ) {}

  set(timer: AttemptTimer, ms: number): void {
    if (this.disposed) return;
    this.clear([timer]);
    const registration = { cancel: () => {} };
    this.pending.set(timer, registration);
    try {
      registration.cancel = this.clock.schedule(() => {
        // A queued callback can arrive even after its browser timer was cleared.
        if (this.pending.get(timer) !== registration) return;
        this.pending.delete(timer);
        this.dispatch({ type: EVENTS[timer] });
      }, ms);
      if (this.pending.get(timer) !== registration) this.cancel(registration);
    } catch (e) {
      if (this.pending.get(timer) === registration) this.pending.delete(timer);
      throw e;
    }
  }

  clear(timers: readonly AttemptTimer[]): void {
    for (const timer of timers) {
      const registration = this.pending.get(timer);
      this.pending.delete(timer);
      if (registration) this.cancel(registration);
    }
  }

  clearAll(): void {
    this.clear([...this.pending.keys()]);
  }
  dispose(): void {
    this.disposed = true;
    this.clearAll();
  }

  private cancel(registration: Registration): void {
    try {
      registration.cancel();
    } catch {
      /* The registration is already invalid; continue the remaining cleanup. */
    }
  }
}
