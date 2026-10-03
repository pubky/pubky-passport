import type { Session } from "@synonymdev/pubky";
import type { AttemptResult } from "../client/AttemptResult.js";
import { PassportError } from "../errors/PassportError.js";
import { mapSdkError } from "../errors/mapSdkError.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import { systemClock, type Clock } from "../shared/Clock.js";
import type { AttemptEffectPort } from "./AttemptEffectPort.js";
import { attemptMachine } from "./attemptMachine.js";
import {
  createAttemptModel,
  isIdleLike,
  type AttemptContext,
  type AttemptEffect,
  type AttemptEvent,
  type AttemptModel,
  type PassportState,
  type SessionInfo,
} from "./attemptModel.js";
import { SessionOwner } from "./SessionOwner.js";
import { AttemptTimers } from "./AttemptTimers.js";

type Listener<T extends unknown[]> = (...args: T) => void;
interface PendingResult {
  promise: Promise<AttemptResult>;
  resolve: (result: AttemptResult) => void;
}
interface QueuedEvent {
  event: AttemptEvent;
  complete?: () => void;
  expectedResult?: Promise<AttemptResult>;
}
type ReceivedSession =
  | Pick<
      Extract<AttemptEvent, { publicKey: string }>,
      "publicKey" | "capabilities" | "capabilitiesMatch"
    >
  | ReturnType<typeof mapSdkError>;

export class AttemptController {
  private model: AttemptModel;
  private lastContext?: AttemptContext;
  private pending: PendingResult | undefined;
  private readonly queue: QueuedEvent[] = [];
  private readonly states = new Set<Listener<[PassportState]>>();
  private readonly sessionListeners = new Set<Listener<[Session, SessionInfo]>>();
  private readonly sessions: SessionOwner;
  private readonly timers: AttemptTimers;
  private dispatching = false;
  private disposeRequested = false;

  constructor(
    instance: PassportInstance,
    private readonly context: () => AttemptContext,
    private readonly effects: AttemptEffectPort,
    private readonly diagnostic?: Listener<[PassportDiagnostic]>,
    clock: Clock = systemClock,
  ) {
    this.model = createAttemptModel(instance);
    this.timers = new AttemptTimers((event) => this.dispatch(event), clock);
    this.sessions = new SessionOwner(
      (ms) =>
        new Promise((resolve) => {
          clock.schedule(resolve, ms);
        }),
      (value) => this.notify(this.diagnostic, value),
    );
  }

  getState(): PassportState {
    return this.model.state;
  }

  /** Internal click coordination only; the public client exposes getState(). */
  snapshot(): AttemptModel {
    return this.model;
  }
  reservedResult(): Promise<AttemptResult> | undefined {
    return this.pending?.promise;
  }

  /** A synchronous native effect must honor app cancellation before the queue advances. */
  isCurrent(model: AttemptModel): boolean {
    return (
      this.model === model &&
      !this.disposeRequested &&
      !this.queue.some(({ event }) => event.type === "CANCEL")
    );
  }

  /** True outside any transition: no event is running or queued and disposal was not requested. */
  quiescent(): boolean {
    return !this.dispatching && this.queue.length === 0 && !this.disposeRequested;
  }

  /** Reserve before calling native open, which can synchronously reenter the client. */
  reserveResult(): Promise<AttemptResult> {
    if (this.disposeRequested)
      return Promise.resolve({ status: "failed", error: this.internalError() });
    if (this.pending) return this.pending.promise;
    let resolve!: PendingResult["resolve"];
    const promise = new Promise<AttemptResult>((settle) => {
      resolve = settle;
    });
    const result = { promise, resolve };
    this.pending = result;
    return result.promise;
  }

  failReservedResult(promise: Promise<AttemptResult>, error: PassportError): void {
    if (this.pending?.promise === promise) this.settle({ status: "failed", error });
  }

  /** Internal only: called after verified opener severance and native navigation return. */
  completeRedirect(model: AttemptModel): void {
    if (!this.isCurrent(model) || model.state.status !== "redirecting" || model.flow === undefined)
      return;
    const flow = model.flows.get(model.flow);
    if (flow?.via === "redirect" && flow.status === "created")
      this.settle({ status: "redirecting" });
  }

  subscribe(listener: Listener<[PassportState]>): () => void {
    if (!this.disposeRequested) this.states.add(listener);
    return () => {
      this.states.delete(listener);
    };
  }

  onSession(listener: Listener<[Session, SessionInfo]>): () => void {
    if (!this.disposeRequested) this.sessionListeners.add(listener);
    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  receiveSession(
    flowId: number,
    session: Session,
    read: ReceivedSession | ((instance: PassportInstance) => ReceivedSession),
  ): void {
    const sessionId = this.sessions.register(session);
    if (sessionId === undefined) return;
    // The runner releases its registry entry before this call; the ledger keeps the pin.
    const instance = this.model.flows.get(flowId)?.instance ?? this.model.state.instance;
    let metadata: ReceivedSession;
    try {
      metadata = typeof read === "function" ? read(instance) : read;
    } catch (e) {
      metadata = mapSdkError(e, "start", this.errorOptions(instance));
    }
    if ("error" in metadata && metadata.diagnostic)
      this.notify(this.diagnostic, { code: metadata.diagnostic });
    this.dispatch({
      type: "SESSION_RECEIVED",
      flowId,
      sessionId,
      ...("error" in metadata ? { error: metadata.error } : metadata),
    });
  }

  cancel(): void {
    const reserved = isIdleLike(this.model.state) ? this.pending?.promise : undefined;
    this.dispatch({ type: "CANCEL" });
    if (reserved)
      this.failReservedResult(
        reserved,
        new PassportError("cancelled", {
          ...this.errorOptions(this.model.state.instance),
          detail: { by: "app" },
        }),
      );
  }
  reset(): void {
    this.dispatch({ type: "RESET" });
  }
  dispose(): void {
    if (this.disposeRequested) return;
    this.disposeRequested = true;
    this.dispatch({ type: "DISPOSE" });
  }

  dispatch(
    event: AttemptEvent,
    complete?: () => void,
    expectedResult?: Promise<AttemptResult>,
  ): void {
    this.queue.push({
      event,
      ...(complete ? { complete } : {}),
      ...(expectedResult ? { expectedResult } : {}),
    });
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        if (!next.expectedResult || this.pending?.promise === next.expectedResult)
          this.transition(next.event);
        this.notify(next.complete);
      }
    } finally {
      this.dispatching = false;
    }
  }

  private transition(event: AttemptEvent): void {
    let context = this.lastContext;
    try {
      context = this.context();
      this.lastContext = context;
    } catch (e) {
      const error = this.internalError(e);
      if (event.type === "SIGN_IN") this.settle({ status: "failed", error });
      if (!context) {
        if (event.type === "SESSION_RECEIVED") {
          // No flow can be allocated before the first successful context snapshot.
          const notifications: (() => void)[] = [];
          this.execute({ type: "RevokeSession", sessionId: event.sessionId }, notifications);
          this.execute(
            { type: "Diagnostic", code: "late_session_revoked", unattributed: true },
            notifications,
          );
          for (const notify of notifications) notify();
        } else this.settle({ status: "failed", error });
        if (event.type === "DISPOSE") {
          this.model = Object.freeze({ ...this.model, disposed: true });
          this.completeDispose();
        }
        return;
      }
      // A failed environment snapshot must not change an owned handle's authority.
      if (
        !["CANCEL", "RESET", "DISPOSE", "SESSION_RECEIVED", "FLOW_CREATED", "RESUMED"].includes(
          event.type,
        )
      )
        event = this.failureEvent(error);
    }
    const before = this.model;
    const next = attemptMachine(before, event, context);
    this.model = next.model;
    const notifications: (() => void)[] = [];
    for (const effect of next.effects) this.execute(effect, notifications);
    if (event.type === "DISPOSE") {
      this.completeDispose();
    }
    if (before.state !== this.model.state) {
      const state = this.model.state;
      const listeners = [...this.states];
      notifications.unshift(() => {
        for (const listener of listeners) this.notify(listener, state);
      });
    }
    // Reentrant events remain queued until cleanup and every notification finish.
    for (const notify of notifications) notify();
  }

  private completeDispose(): void {
    this.timers.dispose();
    void this.sessions.dispose();
    this.notify(() => this.effects.dispose());
    this.states.clear();
    this.sessionListeners.clear();
  }

  private execute(effect: AttemptEffect, notifications: (() => void)[]): void {
    switch (effect.type) {
      case "Diagnostic": {
        const state = this.model.state;
        const value = Object.freeze({
          code: effect.code,
          ...(!effect.unattributed && "attemptId" in state ? { attemptId: state.attemptId } : {}),
        });
        notifications.push(() => this.notify(this.diagnostic, value));
        return;
      }
      case "RevokeSession":
        void this.sessions.revoke(effect.sessionId);
        return;
      case "EmitSession": {
        const session = this.sessions.take(effect.sessionId);
        if (!session) return;
        this.settle({ status: "signed-in", session, info: effect.info });
        const listeners = [...this.sessionListeners];
        notifications.push(() => {
          for (const listener of listeners) this.notify(listener, session, effect.info);
        });
        return;
      }
      default:
        try {
          if (effect.type === "SetTimer") this.timers.set(effect.timer, effect.ms);
          else if (effect.type === "ClearTimer") this.timers.clear(effect.timers);
          else {
            if (effect.type === "EndAttempt") this.timers.clearAll();
            this.effects.run(effect);
          }
        } catch (e) {
          this.queue.push({ event: this.failureEvent(this.internalError(e)) });
        }
        if (effect.type === "EndAttempt" && effect.error)
          this.settle({ status: "failed", error: effect.error });
    }
  }

  private settle(result: AttemptResult): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.resolve(result);
  }

  private failureEvent(error: PassportError): AttemptEvent {
    const state = this.model.state;
    return {
      type: "RUNTIME_FAILED",
      error,
      ...(this.model.flow !== undefined ? { flowId: this.model.flow } : {}),
      ...("attemptId" in state ? { attemptId: state.attemptId } : {}),
    };
  }

  private internalError(cause?: unknown): PassportError {
    return new PassportError("internal", {
      ...this.errorOptions(this.model.state.instance),
      ...(cause !== undefined ? { cause } : {}),
    });
  }

  private errorOptions(instance: PassportInstance) {
    return {
      instance,
      ...(this.lastContext?.messages ? { messages: this.lastContext.messages } : {}),
      context: {
        ...(this.lastContext?.appName !== undefined ? { appName: this.lastContext.appName } : {}),
        ...(this.lastContext ? { defaultHost: this.lastContext.defaultInstance.host } : {}),
      },
    };
  }

  private notify<T extends unknown[]>(listener: Listener<T> | undefined, ...args: T): void {
    try {
      void Promise.resolve(listener?.(...args)).catch(() => {});
    } catch {
      /* Observers cannot reject sign-in or interrupt another observer. */
    }
  }
}
