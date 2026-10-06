import {
  PassportError,
  type PassportErrorCode,
  type PassportErrorDetail,
} from "../errors/PassportError.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import {
  isLiveState,
  isIdleLike,
  isPopupState,
  type AttemptContext,
  type AttemptEffect,
  type AttemptEvent,
  type AttemptModel,
  type AttemptTimer,
  type AttemptTransition,
  type FlowRecord,
  type PassportState,
  type SessionInfo,
  type SignInVia,
} from "./attemptModel.js";

type Draft = { -readonly [K in keyof AttemptModel]: AttemptModel[K] } & {
  flows: Map<number, FlowRecord>;
};
const SEVERANCE_HINT_MS = 3000;
const RETURN_GRACE_MS = 3000;
const RETURN_WITHOUT_MARKER_MS = 10000;
/** The timers of a Ring-ready flow held by a lease. */
const LEASE_TIMERS = [
  "PREPARE_RETRY",
  "RING_ROTATE",
  "RING_PIN_ELAPSED",
  "HIDDEN_CAP",
] as const satisfies readonly AttemptTimer[];

/** A deterministic reducer: time, random IDs and already-opened windows are explicit inputs. */
export function attemptMachine(
  model: AttemptModel,
  event: AttemptEvent,
  context: AttemptContext,
): AttemptTransition {
  const transition = new Transition(model, context);
  transition.receive(event);
  return transition.finish();
}

class Transition {
  private readonly draft: Draft;
  private readonly effects: AttemptEffect[] = [];
  private changed = false;
  constructor(
    private readonly before: AttemptModel,
    private readonly context: AttemptContext,
  ) {
    this.draft = { ...before, flows: new Map(before.flows) };
  }
  finish(): AttemptTransition {
    if (
      !this.draft.disposed &&
      this.context.leases > 0 &&
      (this.draft.state.status === "idle" || this.draft.state.status === "failed") &&
      this.effects.some((effect) => effect.type === "EndAttempt")
    )
      this.prepare();
    return {
      model: this.changed ? Object.freeze(this.draft) : this.before,
      effects: Object.freeze(this.effects),
    };
  }
  receive(event: AttemptEvent): void {
    const m = this.draft;
    const state = m.state;
    if (event.type === "SESSION_RECEIVED") {
      this.session(event);
      return;
    }
    if (event.type === "RESUMED") {
      this.resumed(event.flowId);
      return;
    }
    // Passport's `ready` says whether it can create a missing profile; it counts for the attempt.
    if (event.type === "READY" && event.profileSetup && !m.profileSetup) {
      m.profileSetup = true;
      this.changed = true;
    }
    if (!m.disposed && this.profile(event)) return;
    if (!m.disposed && this.redirect(event)) return;
    if (!m.disposed && this.lease(event)) return;
    if (event.type === "FLOW_CREATED") {
      const flow = m.flows.get(event.flowId);
      if (
        !m.disposed &&
        state.status === "opening" &&
        m.flow === event.flowId &&
        flow?.status === "creating"
      ) {
        this.updateFlow(event.flowId, {
          status: "polling",
          ringLink: event.ringLink,
          exposed: this.context.leases > 0,
        });
        this.state(
          m.popup
            ? { ...state, ringLink: event.ringLink }
            : {
                ...this.base(),
                status: "detached",
                reason: "unreachable",
                ringLink: event.ringLink,
              },
        );
        if (m.popup)
          this.effects.push({
            type: "NavigatePopup",
            popup: m.popup,
            flowId: event.flowId,
            origin: flow.instance.origin,
          });
        this.effects.push({ type: "StartPolling", flowId: event.flowId });
        if (m.popup) this.handshake();
        else this.timer("DETACHED", this.context.timeouts.detachedMs);
      } else this.effects.push({ type: "FreeFlow", flowId: event.flowId });
      return;
    }
    if (m.disposed) return;
    switch (event.type) {
      case "RUNTIME_FAILED":
        if (
          (isLiveState(state) || state.status === "preparing" || state.status === "ready") &&
          (event.flowId === undefined || event.flowId === m.flow) &&
          (event.attemptId === undefined ||
            ("attemptId" in state && event.attemptId === state.attemptId))
        ) {
          if ((state.status === "preparing" || state.status === "ready") && m.flow !== undefined)
            this.lease({
              type: state.status === "preparing" ? "FLOW_FAILED" : "POLL_FAILED",
              flowId: m.flow,
              error: event.error,
            });
          else this.fail(event.error);
        }
        return;
      case "SIGN_IN":
        if ("route" in event) return;
        if (isIdleLike(state) || state.status === "preparing" || state.status === "ready") {
          m.selection = event.instance;
          this.open(event.popup, event.instance, this.context.attemptId);
        }
        return;
      case "FLOW_FAILED":
        if (
          state.status === "opening" &&
          m.flow === event.flowId &&
          m.flows.get(event.flowId)?.status === "creating"
        )
          this.fail(event.error);
        return;
      case "POLL_FAILED":
        if (m.flow === event.flowId && isLiveState(state)) this.fail(event.error);
        else if (m.flows.get(event.flowId)?.status === "draining")
          this.release(event.flowId, "passive", false);
        return;
      case "READY":
        this.ready(event);
        return;
      case "HANDSHAKE_HINT":
        if (state.status === "opening" && state.ringLink) {
          this.state({
            ...this.base(),
            status: "waiting",
            ringLink: state.ringLink,
            handshake: "unconfirmed",
            window: "open",
          });
          this.effects.push(
            { type: "Diagnostic", code: "handshake_missing" },
            { type: "SlowHandshake" },
          );
        }
        return;
      case "POPUP_CLOSED":
        this.closed();
        return;
      case "CLOSED_GRACE":
        if (state.status === "waiting" && state.window === "closed")
          this.fail(
            this.error(
              "popup_closed",
              state.handshake === "unconfirmed" ? { handshake: "unconfirmed" } : undefined,
            ),
          );
        return;
      case "DETACHED_TIMEOUT":
        if (state.status === "detached") this.fail(this.error("timeout"));
        return;
      case "FINISHING_TIMEOUT":
        if (state.status === "finishing" && state.via === "popup") this.fail(this.error("timeout"));
        return;
      case "ATTEMPT_TIMEOUT":
        if (isLiveState(state)) this.fail(this.error("timeout"));
        return;
      case "REOPEN":
        if (state.status === "waiting" || state.status === "detached") {
          if (m.popup) this.effects.push({ type: "ClosePopup", popup: m.popup });
          m.generation++;
          m.popup = event.popup;
          this.state({ ...this.base(), status: "opening", ringLink: state.ringLink });
          this.effects.push({ type: "WatchPopup", popup: event.popup });
          this.handshake();
          this.effects.push({ type: "ClearTimer", timers: ["CLOSED_GRACE", "DETACHED"] });
        }
        return;
      case "FOCUS":
        if (state.status === "waiting" && state.window === "open" && m.popup)
          this.effects.push({ type: "FocusPopup", popup: m.popup });
        return;
      case "STATUS":
        if (state.status === "waiting" && state.phase !== event.phase)
          this.state({ ...state, phase: event.phase });
        return;
      case "OUTCOME":
        this.outcome(event);
        return;
      case "PAGE_HIDE":
        // A window still open for the profile is not left behind either.
        if (
          !event.persisted &&
          m.popup &&
          (isPopupState(state) || state.status === "finishing" || state.status === "needs-profile")
        )
          this.effects.push({ type: "ClosePopup", popup: m.popup });
        return;
      case "USE_DEFAULT_INSTANCE":
        if (!state.instance.isCustom) return;
        if (state.status === "failed") {
          for (const [id, flow] of m.flows)
            if (flow.attemptId === state.attemptId) this.release(id, "abandoned", false);
          this.open(event.popup, this.context.defaultInstance, this.context.attemptId);
        } else if (state.status === "waiting" || state.status === "detached") {
          if (m.popup) this.effects.push({ type: "ClosePopup", popup: m.popup });
          this.effects.push({ type: "StopHandshake" }, { type: "StopHeartbeat" });
          if (m.flow !== undefined) this.release(m.flow, "abandoned", false);
          delete m.flow;
          this.open(event.popup, this.context.defaultInstance, state.attemptId, m.generation + 1);
        }
        return;
      case "CANCEL":
        if (isLiveState(state) || state.status === "preparing" || state.status === "ready")
          this.endIdle(this.error("cancelled", { by: "app" }), "app");
        return;
      case "SELECT_INSTANCE":
        if (isLiveState(state)) return;
        if (event.instance.origin === m.selection.origin) {
          m.selection = event.instance;
          this.changed = true;
          if (state.status === "idle" || state.status === "preparing" || state.status === "ready")
            this.state({ ...state, instance: event.instance });
          return;
        }
        // A29: another Passport withdraws every earlier flow, so none can sign in afterwards.
        this.freeAll();
        m.selection = event.instance;
        if (state.status !== "signed-in") this.state({ status: "idle", instance: event.instance });
        this.effects.push({ type: "ClearTimer", timers: LEASE_TIMERS });
        if (this.context.leases > 0 && state.status !== "signed-in") this.prepare();
        return;
      case "RESET":
        if (
          state.status === "signed-in" ||
          state.status === "failed" ||
          (state.status === "idle" && state.lastError !== undefined)
        ) {
          this.freeAll();
          this.state({ status: "idle", instance: m.selection });
          this.effects.push({ type: "ClearTimer", timers: ["RING_PIN_ELAPSED"] });
          if (this.context.leases > 0) this.prepare();
        }
        return;
      case "DISPOSE":
        this.endIdle(this.error("cancelled", { by: "app" }), "app");
        this.freeAll();
        m.disposed = true;
        return;
    }
  }
  private state(state: PassportState): void {
    this.draft.state = Object.freeze(state);
    this.changed = true;
  }
  private base() {
    const state = this.draft.state;
    return {
      instance: state.instance,
      attemptId: "attemptId" in state ? state.attemptId : this.context.attemptId,
    };
  }
  private error(code: PassportErrorCode, detail?: PassportErrorDetail): PassportError {
    return new PassportError(code, {
      instance: this.draft.state.instance,
      context: {
        defaultHost: this.context.defaultInstance.host,
        ...(this.context.appName !== undefined ? { appName: this.context.appName } : {}),
      },
      ...(this.context.messages ? { messages: this.context.messages } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  private updateFlow(id: number, change: Partial<Omit<FlowRecord, "instance">>): void {
    const flow = this.draft.flows.get(id);
    if (!flow) return;
    this.draft.flows.set(id, Object.freeze({ ...flow, ...change }));
    this.changed = true;
  }
  private timer(timer: AttemptTimer, ms: number): void {
    this.effects.push({ type: "SetTimer", timer, ms });
  }
  /** Allocates the next flow id; `create` also starts it (a resumed flow is restored instead). */
  private allocateFlow(
    instance: PassportInstance,
    attemptId: string,
    via: SignInVia,
    create = true,
  ): number {
    const m = this.draft;
    const flowId = ++m.lastFlowId;
    m.flows.set(
      flowId,
      Object.freeze({ instance, attemptId, via, status: "creating", exposed: false }),
    );
    this.changed = true;
    if (create)
      this.effects.push({
        type: "CreateFlow",
        flowId,
        instance,
        ...(via === "redirect" ? { returnTo: attemptId } : {}),
      });
    return flowId;
  }
  /** A new attempt or flow starts with no Ring pin and no deferred rotation or cap. */
  private resetLeaseFlags(): void {
    this.draft.ringPinned = false;
    this.draft.rotateDue = false;
    this.draft.capDue = false;
    this.changed = true;
  }
  private endIdle(error: PassportError, by: "passive" | "app"): void {
    this.state({ status: "idle", instance: this.draft.selection });
    this.end(error, by);
  }
  private handshake(): void {
    const m = this.draft;
    const flow = m.flow === undefined ? undefined : m.flows.get(m.flow);
    if (!m.popup || !flow) return;
    m.navigatedAt = this.context.now;
    this.changed = true;
    this.effects.push({
      type: "StartHandshake",
      popup: m.popup,
      origin: flow.instance.origin,
      attemptId: this.base().attemptId,
      flowId: m.flow!,
    });
    this.timer("HANDSHAKE_HINT", this.context.timeouts.handshakeHintMs);
  }
  private open(
    popup: Window | undefined,
    instance: PassportInstance,
    attemptId: string,
    generation = 0,
  ): void {
    const m = this.draft;
    const previous = m.state.status;
    const adopt = previous === "preparing" || previous === "ready";
    let flow = adopt && m.flow !== undefined ? m.flows.get(m.flow) : undefined;
    if (flow && flow.instance.origin !== instance.origin) {
      this.release(m.flow!, previous === "ready" ? "passive" : "abandoned", previous === "ready");
      flow = undefined;
    }
    if (!flow) {
      m.flow = this.allocateFlow(instance, attemptId, "popup");
      flow = m.flows.get(m.flow)!;
    } else this.updateFlow(m.flow!, { attemptId, via: "popup" });
    this.resetLeaseFlags();
    if (popup) m.popup = popup;
    else delete m.popup;
    delete m.navigatedAt;
    m.generation = generation;
    this.state(
      !popup && flow.status === "polling" && flow.ringLink
        ? {
            status: "detached",
            instance,
            attemptId,
            ringLink: flow.ringLink,
            reason: "unreachable",
          }
        : {
            status: "opening",
            instance,
            attemptId,
            ...(flow.status === "polling" && flow.ringLink ? { ringLink: flow.ringLink } : {}),
          },
    );
    if (popup) this.effects.push({ type: "WatchPopup", popup });
    if (flow.status === "polling") {
      if (popup) this.handshake();
      else this.timer("DETACHED", this.context.timeouts.detachedMs);
    }
    // Switching a live attempt's instance keeps its existing deadline.
    if (previous !== "waiting" && previous !== "detached")
      this.timer("ATTEMPT", this.context.timeouts.attemptMs);
    if (!popup) this.effects.push({ type: "ClearTimer", timers: ["PREPARE_RETRY", "RING_ROTATE"] });
    else if (previous === "preparing")
      this.effects.push({ type: "ClearTimer", timers: ["PREPARE_RETRY"] });
    else if (previous === "ready")
      this.effects.push({ type: "ClearTimer", timers: ["RING_ROTATE"] });
  }
  private ready(event: Extract<AttemptEvent, { type: "READY" }>): void {
    const state = this.draft.state;
    if (event.status === "completed") {
      if (
        state.status === "opening" ||
        state.status === "detached" ||
        (state.status === "waiting" && state.phase !== "ring")
      )
        this.fail(this.error("request_ended"));
      return;
    }
    if (state.status !== "opening" && state.status !== "waiting") return;
    if (event.status === "invalid") {
      this.fail(
        event.code === "network_mismatch"
          ? this.error("network_mismatch")
          : this.error("request_rejected", event.code ? { rejection: event.code } : undefined),
      );
      return;
    }
    if (event.status === "expired") {
      this.fail(this.error("request_expired"));
      return;
    }
    if (event.status === "empty") {
      if (state.status === "opening" || state.handshake === "unconfirmed")
        this.fail(this.error("request_rejected", { rejection: "empty" }));
      else {
        this.state({
          ...this.base(),
          status: "detached",
          ringLink: state.ringLink,
          reason: "request-lost",
        });
        this.effects.push({ type: "StopHeartbeat" }, { type: "Diagnostic", code: "request_lost" });
        this.timer("DETACHED", this.context.timeouts.detachedMs);
      }
      return;
    }
    if (!state.ringLink || (state.status === "waiting" && state.handshake === "confirmed")) return;
    this.state(
      state.status === "waiting"
        ? { ...state, handshake: "confirmed" }
        : {
            ...this.base(),
            status: "waiting",
            ringLink: state.ringLink,
            handshake: "confirmed",
            window: "open",
          },
    );
    this.effects.push({ type: "StopHandshake" }, { type: "StartHeartbeat" });
    if (state.status === "opening")
      this.effects.push({ type: "ClearTimer", timers: ["HANDSHAKE_HINT"] });
  }
  private closed(): void {
    const state = this.draft.state;
    if (state.status === "opening") {
      this.effects.push({ type: "Diagnostic", code: "window_closed_before_handshake" });
      if (!state.ringLink) {
        this.fail(this.error("popup_closed", { handshake: "unconfirmed" }));
        return;
      }
      this.state({
        ...this.base(),
        status: "detached",
        ringLink: state.ringLink,
        reason: "unreachable",
      });
      const elapsed = this.context.now - (this.draft.navigatedAt ?? -Infinity);
      if (elapsed >= 0 && elapsed <= SEVERANCE_HINT_MS)
        this.effects.push({ type: "Diagnostic", code: "opener_severed_suspected" });
      this.timer("DETACHED", this.context.timeouts.detachedMs);
    } else if (state.status === "waiting" && state.window === "open") {
      this.state({ ...state, window: "closed" });
      this.timer(
        "CLOSED_GRACE",
        state.phase === "ring"
          ? this.context.timeouts.ringGraceMs
          : this.context.timeouts.closedGraceMs,
      );
    }
  }
  private outcome(event: Extract<AttemptEvent, { type: "OUTCOME" }>): void {
    const state = this.draft.state;
    if (
      !isPopupState(state) &&
      state.status !== "finishing" &&
      state.status !== "failed" &&
      state.status !== "signed-in"
    )
      return;
    this.effects.push({ type: "Ack", messageId: event.messageId, version: event.version });
    if (!isPopupState(state)) return;
    if (event.outcome === "success") {
      this.state({ ...this.base(), status: "finishing", via: "popup" });
      this.effects.push(
        { type: "StopHandshake" },
        { type: "StopHeartbeat" },
        { type: "ClearTimer", timers: ["CLOSED_GRACE", "DETACHED"] },
      );
      this.timer("FINISHING", this.context.timeouts.finishingMs);
    } else
      this.fail(
        event.outcome === "cancel"
          ? this.error("cancelled", { by: "user" })
          : this.error("passport_error", event.code ? { passportCode: event.code } : undefined),
      );
  }
  private fail(error: PassportError): void {
    this.state({ ...this.base(), status: "failed", error });
    this.end(error, "passive");
  }
  private release(id: number, by: "passive" | "app" | "abandoned", drain: boolean): void {
    const flow = this.draft.flows.get(id);
    if (!flow) return;
    if (flow.status === "freeing") {
      this.updateFlow(id, { endedBy: by });
      return;
    }
    this.effects.push(
      drain
        ? { type: "RetireFlow", flowId: id, ms: this.context.timeouts.ringGraceMs }
        : { type: "FreeFlow", flowId: id },
    );
    this.updateFlow(id, { status: drain ? "draining" : "freeing", endedBy: by });
  }
  private end(error: PassportError | undefined, by: "passive" | "app"): void {
    const m = this.draft;
    if (m.heldSession && m.state.status !== "signed-in")
      this.effects.push({ type: "RevokeSession", sessionId: m.heldSession.sessionId });
    delete m.heldSession;
    delete m.profileChecking;
    delete m.profileSetup;
    delete m.profileAsked;
    delete m.fastRechecks;
    if (m.flow !== undefined)
      this.release(m.flow, by, by === "passive" && m.flows.get(m.flow)?.exposed === true);
    if (m.redirectQr !== undefined) this.release(m.redirectQr, by, by === "passive");
    this.effects.push({
      type: "EndAttempt",
      ...(error ? { error } : {}),
      by,
    });
    delete m.flow;
    delete m.popup;
    delete m.navigatedAt;
    delete m.redirectQr;
    delete m.redirectCause;
    delete m.returnMarker;
    this.changed = true;
  }
  private freeAll(): void {
    for (const id of this.draft.flows.keys()) this.release(id, "app", false);
    delete this.draft.flow;
    this.resetLeaseFlags();
    this.draft.hiddenCapped = false;
    this.draft.prepareFailures = 0;
  }

  private lease(event: AttemptEvent): boolean {
    const m = this.draft;
    const state = m.state;
    switch (event.type) {
      case "PREPARE":
      case "PREPARE_RETRY":
        if (
          this.context.leases > 0 &&
          (state.status === "idle" || (event.type === "PREPARE" && state.status === "failed"))
        )
          this.prepare();
        return true;
      case "FLOW_CREATED":
        if (state.status !== "preparing" || m.flow !== event.flowId) return false;
        this.updateFlow(event.flowId, {
          status: "polling",
          exposed: true,
          ringLink: event.ringLink,
        });
        this.state({ ...state, status: "ready", ringLink: event.ringLink });
        m.prepareFailures = 0;
        this.effects.push({ type: "StartPolling", flowId: event.flowId });
        this.timer("RING_ROTATE", this.context.timeouts.ringLinkRotateMs);
        if (!this.context.visible) this.timer("HIDDEN_CAP", this.context.timeouts.attemptMs);
        return true;
      case "FLOW_FAILED":
      case "POLL_FAILED":
        if (
          m.flow !== event.flowId ||
          (event.type === "FLOW_FAILED" ? state.status !== "preparing" : state.status !== "ready")
        )
          return false;
        this.release(event.flowId, "passive", false);
        delete m.flow;
        this.state({ status: "idle", instance: m.selection, lastError: event.error });
        this.timer("PREPARE_RETRY", [5000, 30000, 120000][Math.min(m.prepareFailures++, 2)]!);
        return true;
      case "RING_ROTATE":
        if (state.status === "ready") {
          if (this.context.visible && !m.ringPinned) this.rotate();
          else {
            // The code may not be scanned any more; it is replaced as soon as it can be.
            m.rotateDue = true;
            this.state({ ...state, expired: true });
          }
        }
        return true;
      case "RING_RELOAD":
        // A62: the expired code asks for a fresh request at once.
        if (this.context.leases > 0) {
          if (state.status === "ready") this.rotate();
          else if (state.status === "idle" || state.status === "failed") this.prepare();
        }
        return true;
      case "RING_OPENED":
        if (state.status === "ready") {
          m.ringPinned = true;
          this.changed = true;
          this.timer("RING_PIN_ELAPSED", this.context.timeouts.ringGraceMs);
        }
        return true;
      case "RING_PIN_ELAPSED":
        if (state.status === "ready" && m.ringPinned) {
          m.ringPinned = false;
          this.changed = true;
          if (this.context.leases === 0) this.releaseLease();
          else if (m.rotateDue && this.context.visible) this.rotate();
          else if (m.capDue && !this.context.visible) this.capHiddenFlow();
        }
        return true;
      case "LEASE_IDLE":
        if (
          this.context.leases === 0 &&
          (state.status === "preparing" || (state.status === "ready" && !m.ringPinned))
        )
          this.releaseLease();
        return true;
      case "HIDDEN_CAP":
        if (state.status === "ready" && !this.context.visible) {
          if (m.ringPinned) {
            m.capDue = true;
            this.changed = true;
          } else this.capHiddenFlow();
        }
        return true;
      case "DOCUMENT_HIDDEN":
        if (state.status === "ready" && !this.context.visible)
          this.timer("HIDDEN_CAP", this.context.timeouts.attemptMs);
        return true;
      case "DOCUMENT_VISIBLE":
        if (this.context.visible) {
          if (state.status === "ready") {
            if (m.capDue) {
              m.capDue = false;
              this.changed = true;
            }
            if (m.rotateDue && !m.ringPinned) this.rotate();
            else this.effects.push({ type: "ClearTimer", timers: ["HIDDEN_CAP"] });
          } else if (state.status === "idle" && m.hiddenCapped && this.context.leases > 0)
            this.prepare();
        }
        return true;
      default:
        return false;
    }
  }
  private prepare(): void {
    const m = this.draft;
    const state = m.state;
    const lastError =
      state.status === "failed" ? state.error : "lastError" in state ? state.lastError : undefined;
    this.resetLeaseFlags();
    m.hiddenCapped = false;
    this.effects.push({ type: "ClearTimer", timers: LEASE_TIMERS });
    m.flow = this.allocateFlow(m.selection, this.context.attemptId, "ring");
    this.state({ status: "preparing", instance: m.selection, ...(lastError ? { lastError } : {}) });
  }
  private rotate(): void {
    if (this.draft.flow !== undefined) this.release(this.draft.flow, "passive", true);
    this.prepare();
  }
  private capHiddenFlow(): void {
    this.releaseLease();
    this.draft.hiddenCapped = true;
    this.draft.capDue = false;
  }
  private releaseLease(): void {
    const m = this.draft;
    const state = m.state;
    if (m.flow !== undefined) this.release(m.flow, "passive", state.status === "ready");
    delete m.flow;
    this.state({
      status: "idle",
      instance: m.selection,
      ...("lastError" in state && state.lastError ? { lastError: state.lastError } : {}),
    });
    this.effects.push({ type: "ClearTimer", timers: LEASE_TIMERS });
  }

  private redirect(event: AttemptEvent): boolean {
    const m = this.draft;
    const state = m.state;
    switch (event.type) {
      case "SIGN_IN":
        if (!("route" in event)) return false;
        if (isIdleLike(state) || state.status === "preparing" || state.status === "ready")
          this.startRoute(event);
        return true;
      case "FLOW_CREATED":
        if (
          state.status !== "redirecting" ||
          m.flow !== event.flowId ||
          m.flows.get(event.flowId)?.status !== "creating"
        )
          return false;
        this.updateFlow(event.flowId, { status: "created" });
        this.effects.push({ type: "SaveStateAndNavigate", flowId: event.flowId });
        return true;
      case "FLOW_FAILED":
        if (state.status !== "redirecting" || m.flow !== event.flowId) return false;
        this.fail(event.error);
        return true;
      case "POLL_FAILED":
        if (m.redirectQr !== event.flowId) return false;
        this.release(event.flowId, "passive", false);
        delete m.redirectQr;
        return true;
      case "REDIRECT_SAVE_FAILED":
        if (state.status === "redirecting") {
          this.effects.push({ type: "Diagnostic", code: "redirect_unavailable" });
          this.fail(
            this.error(m.redirectCause === "blocked" ? "popup_blocked" : "unsupported_environment"),
          );
        }
        return true;
      case "PAGE_RESTORED":
        if (
          state.status === "redirecting" &&
          m.flow !== undefined &&
          m.flows.get(m.flow)?.status === "created"
        ) {
          m.returnMarker = "none";
          this.state({ ...this.base(), status: "finishing", via: "redirect" });
          this.updateFlow(m.flow, { status: "polling" });
          this.effects.push(
            { type: "DeleteRedirectState" },
            { type: "StartPolling", flowId: m.flow },
          );
          this.timer("FINISHING", RETURN_WITHOUT_MARKER_MS);
        }
        return true;
      case "RETURN_DETECTED":
        if (state.status !== "idle") return true;
        if (!event.valid) {
          this.fail(this.error("resume_failed"));
          return true;
        }
        m.returnMarker = event.marker;
        m.flow = this.allocateFlow(event.instance, event.attemptId, "redirect", false);
        this.state({
          status: "finishing",
          via: "redirect",
          instance: event.instance,
          attemptId: event.attemptId,
        });
        this.effects.push({ type: "ResumeFlow", flowId: m.flow });
        return true;
      case "RESUME_FAILED":
        if (state.status === "finishing" && state.via === "redirect" && m.flow === event.flowId)
          this.fail(this.error("resume_failed"));
        return true;
      case "FINISHING_TIMEOUT":
        if (state.status !== "finishing" || state.via !== "redirect") return false;
        // A36: the view returns to idle silently; only a waiting signIn learns resume failed.
        if (m.returnMarker === "none") this.endIdle(this.error("resume_failed"), "passive");
        else
          this.fail(
            m.returnMarker === "c"
              ? this.error("cancelled", { by: "user" })
              : this.error(m.returnMarker === "e" ? "passport_error" : "resume_failed"),
          );
        return true;
      default:
        return false;
    }
  }
  private startRoute(event: Extract<AttemptEvent, { route: unknown }>): void {
    const m = this.draft;
    const previous = m.state.status;
    if (
      m.flow !== undefined &&
      (previous === "preparing" || m.flows.get(m.flow)?.instance.origin !== event.instance.origin)
    ) {
      this.release(m.flow, previous === "ready" ? "passive" : "abandoned", previous === "ready");
      delete m.flow;
    }
    m.selection = event.instance;
    this.resetLeaseFlags();
    const attemptId = this.context.attemptId;
    const route = event.route;
    if ("diagnostic" in route && route.diagnostic)
      this.effects.push({ type: "Diagnostic", code: route.diagnostic });
    this.state({ status: "redirecting", instance: event.instance, attemptId });
    if (route.kind === "failed") {
      this.fail(this.error(route.code));
      return;
    }
    m.redirectCause = route.cause;
    // A Ring code already on screen keeps answering while this tab goes to Passport.
    if (m.flow !== undefined) {
      this.updateFlow(m.flow, { attemptId });
      m.redirectQr = m.flow;
    }
    m.flow = this.allocateFlow(event.instance, attemptId, "redirect");
    this.timer("ATTEMPT", this.context.timeouts.attemptMs);
    if (previous === "ready" || previous === "preparing")
      this.effects.push({ type: "ClearTimer", timers: ["RING_ROTATE", "PREPARE_RETRY"] });
  }
  private resumed(flowId: number): void {
    const m = this.draft;
    if (
      m.disposed ||
      m.state.status !== "finishing" ||
      m.state.via !== "redirect" ||
      m.flow !== flowId
    ) {
      this.effects.push({ type: "FreeFlow", flowId });
      return;
    }
    if (m.flows.get(flowId)?.status !== "creating") return;
    this.updateFlow(flowId, { status: "polling" });
    this.effects.push({ type: "StartPolling", flowId });
    this.timer(
      "FINISHING",
      m.returnMarker === "s"
        ? this.context.timeouts.finishingMs
        : m.returnMarker === "none"
          ? RETURN_WITHOUT_MARKER_MS
          : RETURN_GRACE_MS,
    );
  }
  private session(event: Extract<AttemptEvent, { type: "SESSION_RECEIVED" }>): void {
    const m = this.draft;
    const before = m.state;
    const flow = m.flows.get(event.flowId);
    if (!flow) {
      this.effects.push(
        { type: "RevokeSession", sessionId: event.sessionId },
        { type: "Diagnostic", code: "late_session_revoked", unattributed: true },
      );
      return;
    }
    const appEnded = flow.endedBy === "app" || flow.endedBy === "abandoned";
    const duplicate =
      before.status === "signed-in" ||
      before.status === "needs-profile" ||
      m.heldSession !== undefined ||
      event.flowId <= m.supersededThrough;
    if (appEnded || duplicate) {
      this.effects.push(
        { type: "RevokeSession", sessionId: event.sessionId },
        {
          type: "Diagnostic",
          code: appEnded ? "late_session_revoked" : "duplicate_session_revoked",
        },
      );
      this.release(event.flowId, flow.endedBy ?? "passive", false);
      if (m.flow === event.flowId) delete m.flow;
      return;
    }
    if ("error" in event) {
      this.unreadableSession(event);
      return;
    }
    const live = isLiveState(before);
    this.release(event.flowId, "passive", false);
    if (!event.capabilitiesMatch) {
      const error = this.error("capability_mismatch");
      this.effects.push(
        { type: "RevokeSession", sessionId: event.sessionId },
        { type: "Diagnostic", code: "capability_mismatch" },
      );
      this.state({ ...this.base(), status: "failed", error });
      if (live) this.end(error, "passive");
      else this.finishIdleFlow(event.flowId);
      return;
    }
    const info = Object.freeze({ publicKey: event.publicKey });
    // The Session is held until its profile is read: the app receives both together.
    m.heldSession = Object.freeze({ sessionId: event.sessionId, info });
    this.state({
      status: "finishing",
      instance: flow.instance,
      attemptId: live && "attemptId" in before ? before.attemptId : flow.attemptId,
      via: flow.via,
    });
    // Passport's window stays open until the profile is known: it may be asked to create it.
    this.effects.push(
      { type: "StopHandshake" },
      { type: "StopHeartbeat" },
      { type: "ClearTimer", timers: ["FINISHING", "CLOSED_GRACE", "DETACHED"] },
    );
    if (!live) {
      this.finishIdleFlow(event.flowId);
    } else if (m.flow === event.flowId) delete m.flow;
    if (!live || flow.via === "redirect") this.timer("ATTEMPT", this.context.timeouts.attemptMs);
    this.checkProfile();
  }
  private profile(event: AttemptEvent): boolean {
    const m = this.draft;
    const held = m.heldSession;
    if (!held) return false;
    switch (event.type) {
      case "PROFILE_FOUND":
      case "PROFILE_MISSING":
      case "PROFILE_CHECK_FAILED":
        if (event.sessionId !== held.sessionId || !m.profileChecking) return true;
        delete m.profileChecking;
        if (event.type === "PROFILE_CHECK_FAILED")
          this.effects.push({ type: "Diagnostic", code: "profile_check_failed" });
        if (event.type === "PROFILE_FOUND" || this.context.profile === "optional") {
          this.state({ ...this.base(), status: "signed-in", publicKey: held.info.publicKey });
          this.emitSession(held.sessionId, {
            ...held.info,
            profile: event.type === "PROFILE_FOUND" ? event.profile : null,
            instance: this.draft.state.instance.origin,
          });
          this.end(undefined, "passive");
        } else {
          if (m.state.status === "finishing")
            this.timer("ATTEMPT", this.context.timeouts.attemptMs);
          // A bound Passport that can create profiles is asked once, in the window it has open.
          const ask =
            event.type === "PROFILE_MISSING" &&
            m.popup !== undefined &&
            m.profileSetup === true &&
            !m.profileAsked;
          if (ask) {
            m.profileAsked = true;
            this.effects.push({ type: "ProfileNeeded", publicKey: held.info.publicKey });
          } else if (m.popup && !m.profileAsked) this.closeProfileWindow();
          this.state({
            ...this.base(),
            status: "needs-profile",
            publicKey: held.info.publicKey,
            check: event.type === "PROFILE_MISSING" ? "missing" : "error",
            ...(m.popup && m.profileAsked ? { passport: "open" as const } : {}),
          });
          const fast = m.fastRechecks ?? 0;
          if (fast > 0) m.fastRechecks = fast - 1;
          this.timer("PROFILE_RECHECK", fast > 0 ? 1000 : 5000);
        }
        return true;
      case "PROFILE_READY":
        // Only a prompt to look again: the profile must still be read before the Session goes.
        m.fastRechecks = 5;
        this.changed = true;
        this.checkProfile();
        return true;
      case "PROFILE_WINDOW": {
        // A window this state cannot adopt is closed again by the runtime that opened it.
        const state = m.state;
        if (state.status !== "needs-profile" || state.passport || m.popup) return true;
        m.popup = event.popup;
        // The profile page names the key itself: opening it is the ask.
        m.profileAsked = true;
        this.effects.push(
          { type: "WatchPopup", popup: event.popup },
          {
            type: "StartProfileHandshake",
            popup: event.popup,
            origin: state.instance.origin,
            attemptId: state.attemptId,
            publicKey: state.publicKey,
          },
        );
        this.state({ ...state, passport: "open" });
        return true;
      }
      case "POPUP_CLOSED": {
        // Closing Passport keeps the Session held; the button reopens the profile setup.
        const state = m.state;
        if (!m.popup || (state.status !== "finishing" && state.status !== "needs-profile"))
          return false;
        this.effects.push({ type: "StopHandshake" }, { type: "StopHeartbeat" });
        delete m.popup;
        this.changed = true;
        if (state.status === "needs-profile" && state.passport) {
          const closed: Partial<typeof state> = { ...state };
          delete closed.passport;
          this.state(closed as typeof state);
        }
        return true;
      }
      case "READY":
      case "STATUS":
      case "OUTCOME":
        // Messages about the finished request change nothing while the profile is settled; a
        // ready from the profile page ends its hello loop (the binding stays for profile-ready).
        if (event.type === "READY" && m.state.status === "needs-profile" && m.state.passport)
          this.effects.push({ type: "StopHandshake" });
        if (event.type === "OUTCOME")
          this.effects.push({ type: "Ack", messageId: event.messageId, version: event.version });
        return true;
      case "FOCUS":
      case "DOCUMENT_VISIBLE":
      case "PROFILE_RECHECK":
        if (
          m.state.status === "needs-profile" &&
          (event.type !== "PROFILE_RECHECK" || this.context.visible)
        )
          this.checkProfile();
        return true;
      case "FINISHING_TIMEOUT":
        return true;
      case "ATTEMPT_TIMEOUT":
        if (m.state.status !== "needs-profile") return false;
        this.fail(this.error("profile_required"));
        return true;
      default:
        return false;
    }
  }
  /** Passport cannot create the profile here: its window closes as it did before the Session. */
  private closeProfileWindow(): void {
    const m = this.draft;
    if (!m.popup) return;
    this.effects.push(
      { type: "ClosePopup", popup: m.popup },
      { type: "StopHandshake" },
      { type: "StopHeartbeat" },
    );
    delete m.popup;
    this.changed = true;
  }
  private checkProfile(): void {
    const m = this.draft;
    if (!m.heldSession || m.profileChecking) return;
    m.profileChecking = true;
    this.changed = true;
    this.effects.push(
      { type: "ClearTimer", timers: ["PROFILE_RECHECK"] },
      {
        type: "CheckProfile",
        sessionId: m.heldSession.sessionId,
        publicKey: m.heldSession.info.publicKey,
      },
    );
  }
  private emitSession(sessionId: number, info: SessionInfo): void {
    this.draft.supersededThrough = this.draft.lastFlowId;
    this.changed = true;
    this.effects.push({ type: "EmitSession", sessionId, info });
  }
  private unreadableSession(
    event: Extract<AttemptEvent, { sessionId: number; error: PassportError }>,
  ): void {
    const m = this.draft;
    // Decide the poll-failure role before freeing changes the ledger status.
    const active = m.flow === event.flowId && isLiveState(m.state);
    const ready = m.flow === event.flowId && m.state.status === "ready";
    const companion = m.redirectQr === event.flowId;
    this.effects.push({ type: "RevokeSession", sessionId: event.sessionId });
    this.release(event.flowId, "passive", false);
    if (active) this.fail(event.error);
    else if (ready) this.lease({ type: "POLL_FAILED", flowId: event.flowId, error: event.error });
    else if (companion) delete m.redirectQr;
    else if (m.flow === event.flowId) delete m.flow;
  }
  private finishIdleFlow(receivedFlow: number): void {
    const m = this.draft;
    if (m.flow !== undefined && m.flow !== receivedFlow)
      this.release(m.flow, "passive", m.flows.get(m.flow)?.exposed === true);
    delete m.flow;
    m.ringPinned = false;
    this.effects.push({ type: "ClearTimer", timers: LEASE_TIMERS });
  }
}
