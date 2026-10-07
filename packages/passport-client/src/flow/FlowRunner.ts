import type { Session } from "@synonymdev/pubky";
import { PassportError, type PassportErrorOptions } from "../errors/PassportError.js";
import { mapSdkError } from "../errors/mapSdkError.js";
import { systemClock, type Clock } from "../shared/Clock.js";
import type { FlowHandle, FlowResult } from "./FlowPort.js";

type Failure = ReturnType<typeof mapSdkError>;
interface FlowObserver {
  /** Internal sink: claim ownership synchronously, before inspecting the Session. */
  session(session: Session): void;
  failure(failure: Failure): void;
  freed?(): void;
}
interface Timer {
  cancel(): void;
}

/**
 * The wait after an empty poll. `tryPollOnce()` does not reach the relay: the SDK keeps one
 * long-poll open there in the background (renewed after the relay's 25 s limit) and the call only
 * looks whether it brought the answer, at once (measured on httprelay.pubky.app with SDK 0.11 and
 * 0.12). Polling without a pause would only spin the page; this pace still shows an approval
 * within a third of a second. A hidden tab looks less often.
 */
export const EMPTY_POLL_MS = 300;
export const HIDDEN_POLL_MS = 1_000;

/** Owns one native flow; retirement never frees a handle borrowed by a poll. */
export class FlowRunner {
  #flow: FlowHandle;
  #observer: FlowObserver;
  #clock: Clock;
  #errors: Omit<PassportErrorOptions, "cause" | "detail">;
  #url: string | undefined;
  #initialFailure?: Failure;
  #running = false;
  #pending = false;
  #polled = false;
  #retired = false;
  #stopped = false;
  #freed = false;
  #timers = new Map<"poll" | "retire", Timer>();

  constructor(
    flow: FlowHandle,
    observer: FlowObserver,
    clock: Clock = systemClock,
    errors: Omit<PassportErrorOptions, "cause" | "detail"> = {},
    private readonly visible: () => boolean = () => true,
  ) {
    this.#flow = flow;
    this.#observer = observer;
    this.#clock = clock;
    this.#errors = errors;
    try {
      this.#url = flow.authorizationUrl;
    } catch (e) {
      this.#initialFailure = mapSdkError(e, "start", errors);
    }
  }

  get authorizationUrl(): string | undefined {
    return this.#url;
  }

  start(): void {
    if (this.#stopped || this.#running) return;
    if (this.#initialFailure) {
      this.free();
      this.report(this.#initialFailure);
      return;
    }
    this.#running = true;
    void this.poll();
  }

  retire(ms: number): void {
    if (this.#stopped || this.#retired) return;
    this.#retired = true;
    this.#url = undefined;
    try {
      this.schedule("retire", () => this.free(), ms);
    } catch (e) {
      this.free();
      this.report(mapSdkError(e, "poll", this.#errors));
      return;
    }
    this.start();
  }

  /**
   * The SDK's delegated save: the key stays non-extractable in the SDK's IndexedDB store; the
   * saved state still carries the relay secret, so it is kept briefly and deleted after use.
   */
  save(): FlowResult<string> {
    if (this.#polled || this.#retired || this.#stopped || this.#initialFailure) {
      return { ok: false, error: new PassportError("internal", this.#errors) };
    }
    // A cookie flow (the classic QR) cannot be saved: a same-tab sign-in is not offered for it.
    if (!this.#flow.saveDelegated) {
      return { ok: false, error: new PassportError("internal", this.#errors) };
    }
    try {
      return { ok: true, value: this.#flow.saveDelegated() };
    } catch (e) {
      return { ok: false, ...mapSdkError(e, "start", this.#errors) };
    }
  }

  free(): void {
    this.#stopped = true;
    this.#running = false;
    this.#url = undefined;
    for (const [name, timer] of this.#timers) {
      this.#timers.delete(name);
      this.cancel(timer);
    }
    this.freeSettledHandle();
  }

  private freeSettledHandle(): void {
    if (this.#pending || this.#freed) return;
    this.#freed = true;
    try {
      this.#flow.free();
    } catch {
      /* Cleanup is attempted once, including when the native wrapper throws. */
    }
    try {
      void Promise.resolve(this.#observer.freed?.()).catch(() => {});
    } catch {
      /* Native cleanup has finished; notification cannot make it repeat. */
    }
  }

  private async poll(): Promise<void> {
    if (!this.#running || this.#pending || this.#stopped) return;
    this.#pending = this.#polled = true;
    let session: Session | undefined;
    try {
      session = await this.#flow.tryPollOnce();
    } catch (e) {
      this.#pending = false;
      this.#running = false;
      if (this.#stopped) this.freeSettledHandle();
      else this.report(mapSdkError(e, "poll", this.#errors));
      return;
    }
    this.#pending = false;
    if (session) {
      this.free();
      try {
        void Promise.resolve(this.#observer.session(session)).catch((e: unknown) => {
          this.report(mapSdkError(e, "poll", this.#errors));
        });
      } catch (e) {
        this.report(mapSdkError(e, "poll", this.#errors));
      }
      return;
    }
    if (this.#stopped) {
      this.freeSettledHandle();
      return;
    }
    try {
      // Paced between empty responses, without overlapping native borrows.
      this.schedule(
        "poll",
        () => {
          void this.poll();
        },
        this.pace(),
      );
    } catch (e) {
      this.#running = false;
      this.report(mapSdkError(e, "poll", this.#errors));
    }
  }

  private pace(): number {
    try {
      return this.visible() ? EMPTY_POLL_MS : HIDDEN_POLL_MS;
    } catch {
      return EMPTY_POLL_MS;
    }
  }

  private schedule(name: "poll" | "retire", callback: () => void, ms: number): void {
    const timer = { cancel: () => {} };
    this.#timers.set(name, timer);
    try {
      timer.cancel = this.#clock.schedule(() => {
        if (this.#timers.get(name) !== timer) return;
        this.#timers.delete(name);
        callback();
      }, ms);
      if (this.#timers.get(name) !== timer) this.cancel(timer);
    } catch (e) {
      if (this.#timers.get(name) === timer) this.#timers.delete(name);
      throw e;
    }
  }

  private cancel(timer: Timer): void {
    try {
      timer.cancel();
    } catch {
      /* The registration is invalidated before invoking its cancellation hook. */
    }
  }

  private report(failure: Failure): void {
    try {
      void Promise.resolve(this.#observer.failure(failure)).catch(() => {});
    } catch {
      /* An observer cannot interrupt native handle cleanup. */
    }
  }
}
