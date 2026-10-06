// @vitest-environment node
import { expect, test } from "vitest";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { PassportError } from "../errors/PassportError.js";
import { createRingLink } from "../shared/RingLink.js";
import { attemptMachine } from "./attemptMachine.js";
import {
  createAttemptModel,
  type AttemptContext,
  type AttemptEvent,
  type AttemptModel,
} from "./attemptModel.js";

const D = Object.freeze({
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
});
const C = Object.freeze({
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
});
const W = Object.freeze({ name: "first" }) as unknown as Window;
const W2 = Object.freeze({ name: "reopened" }) as unknown as Window;
const LINK = createRingLink(() => "pubkyauth://" + "private-canary");
const CTX: AttemptContext = {
  defaultInstance: D,
  attemptId: "0123456789abcdefABCDEF",
  now: 1000,
  leases: 0,
  visible: true,
  profile: "optional",
  timeouts: {
    handshakeHintMs: 15,
    closedGraceMs: 25,
    ringGraceMs: 90,
    detachedMs: 600,
    finishingMs: 60,
    attemptMs: 1800,
    ringLinkRotateMs: 300,
  },
};
const run = (model: AttemptModel, event: AttemptEvent, context: Partial<AttemptContext> = {}) =>
  attemptMachine(model, event, { ...CTX, ...context });
const start = (instance: PassportInstance = D) =>
  run(createAttemptModel(instance), { type: "SIGN_IN", popup: W, instance }).model;
const live = (instance: PassportInstance = D) => {
  const m = start(instance);
  return run(m, { type: "FLOW_CREATED", flowId: m.flow!, ringLink: LINK }).model;
};
const waiting = (confirmed = true, instance: PassportInstance = D) =>
  run(live(instance), confirmed ? { type: "READY", status: "valid" } : { type: "HANDSHAKE_HINT" })
    .model;
const effects = (result: ReturnType<typeof run>) => result.effects.map((effect) => effect.type);
const errorCode = (model: AttemptModel) =>
  model.state.status === "failed" ? model.state.error.code : undefined;
const prepared = (creating = false, instance: PassportInstance = D) => {
  const m = { ...live(instance) };
  delete m.popup;
  const flow = m.flows.get(m.flow!)!;
  return {
    ...m,
    state: creating
      ? { status: "preparing" as const, instance }
      : { status: "ready" as const, instance, ringLink: LINK },
    flows: new Map([
      [
        m.flow!,
        {
          ...flow,
          status: creating ? ("creating" as const) : ("polling" as const),
          exposed: !creating,
        },
      ],
    ]),
  } satisfies AttemptModel;
};

test.each(["idle", "failed", "signed-in"] as const)(
  "starts a fresh popup attempt from %s",
  (status) => {
    const m = createAttemptModel(C);
    const state =
      status === "idle"
        ? m.state
        : status === "failed"
          ? {
              status,
              instance: C,
              attemptId: "previous-attempt",
              error: new PassportError("timeout"),
            }
          : {
              status,
              instance: C,
              attemptId: "previous-attempt",
              publicKey: "public-key",
              via: "ring" as const,
            };
    const result = run({ ...m, state }, { type: "SIGN_IN", popup: W, instance: C });
    expect(result.model.state).toEqual({
      status: "opening",
      attemptId: CTX.attemptId,
      instance: C,
    });
    expect(result.model.popup).toBe(W);
    expect(result.model.flows.get(result.model.flow!)?.instance).toBe(C);
    expect(result.effects).toEqual([
      { type: "CreateFlow", flowId: 1, instance: C },
      { type: "WatchPopup", popup: W },
      { type: "SetTimer", timer: "ATTEMPT", ms: 1800 },
    ]);
  },
);

test("adopts a preparation in flight without creating a second flow", () => {
  const before = prepared(true);
  const result = run(before, { type: "SIGN_IN", popup: W, instance: D });
  expect(result.model.flow).toBe(before.flow);
  expect(effects(result)).not.toContain("CreateFlow");
  expect(result.effects).toContainEqual({ type: "ClearTimer", timers: ["PREPARE_RETRY"] });
  const created = run(result.model, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK });
  expect(created.effects).toContainEqual({
    type: "NavigatePopup",
    popup: W,
    flowId: before.flow!,
    origin: D.origin,
  });
});

test("adopts a ready URL already opened by the API", () => {
  const before = prepared();
  const result = run(before, { type: "SIGN_IN", popup: W, instance: D });
  expect(result.model.flow).toBe(before.flow);
  expect(result.model.state).toMatchObject({ status: "opening", ringLink: LINK });
  expect(effects(result)).not.toContain("CreateFlow");
  expect(effects(result)).not.toContain("NavigatePopup");
  expect(effects(result)).toContain("StartHandshake");
  expect(result.effects).toContainEqual({ type: "ClearTimer", timers: ["RING_ROTATE"] });
});

test("creation navigates the owned window, then polls and starts the handshake", () => {
  const before = start();
  const result = run(before, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK });
  expect(effects(result)).toEqual(["NavigatePopup", "StartPolling", "StartHandshake", "SetTimer"]);
  expect(result.model.state).toEqual({
    status: "opening",
    instance: D,
    attemptId: CTX.attemptId,
    ringLink: LINK,
  });
  expect(result.model.navigatedAt).toBe(1000);
  expect(JSON.stringify(result.model.state)).not.toContain("private-canary");
  expect(result.model.state).not.toHaveProperty("popup");
  expect(before.state).not.toHaveProperty("ringLink");
});

test("creation failure ends once with the mapped error", () => {
  const before = start();
  const error = new PassportError("network");
  const result = run(before, { type: "FLOW_FAILED", flowId: before.flow!, error });
  expect(result.model.state).toMatchObject({ status: "failed", error });
  expect(effects(result).filter((x) => x === "EndAttempt")).toHaveLength(1);
});

test("close during creation fails with unconfirmed detail and frees a late creation", () => {
  const before = start();
  const result = run(before, { type: "POPUP_CLOSED" });
  expect(result.model.state).toMatchObject({
    status: "failed",
    error: { code: "popup_closed", detail: { handshake: "unconfirmed" } },
  });
  expect(result.effects).toContainEqual({
    type: "Diagnostic",
    code: "window_closed_before_handshake",
  });
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
  expect(
    run(result.model, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK }).effects,
  ).toEqual([{ type: "FreeFlow", flowId: before.flow }]);
});

test("ready valid confirms and replaces handshake polling with heartbeat", () => {
  const result = run(live(), { type: "READY", status: "valid" });
  expect(result.model.state).toMatchObject({
    status: "waiting",
    handshake: "confirmed",
    window: "open",
  });
  expect(effects(result)).toEqual(["StopHandshake", "StartHeartbeat", "ClearTimer"]);
  const again = run(result.model, { type: "READY", status: "valid" });
  expect(again.model).toBe(result.model);
  expect(again.effects).toEqual([]);
});

test.each(["invalid", "expired", "empty"] as const)("rejects an opening ready %s", (status) => {
  const result = run(live(C), { type: "READY", status, code: "history_unavailable" });
  expect(errorCode(result.model)).toBe(
    status === "expired" ? "request_expired" : "request_rejected",
  );
  if (status !== "expired")
    expect(result.model.state).toMatchObject({
      error: { detail: { rejection: status === "empty" ? "empty" : "history_unavailable" } },
    });
  expect(effects(result)).toContain("EndAttempt");
});

test("unconfirmed empty rejects, confirmed empty detaches as a lost request", () => {
  expect(errorCode(run(waiting(false), { type: "READY", status: "empty" }).model)).toBe(
    "request_rejected",
  );
  const result = run(waiting(), { type: "READY", status: "empty" });
  expect(result.model.state).toMatchObject({ status: "detached", reason: "request-lost" });
  expect(effects(result)).toEqual(["StopHeartbeat", "Diagnostic", "SetTimer"]);
  expect(result.effects).toContainEqual({ type: "SetTimer", timer: "DETACHED", ms: 600 });
  expect(effects(result)).not.toContain("FreeFlow");
});

test("the handshake hint keeps slow hello polling until a later confirmation", () => {
  const result = run(live(), { type: "HANDSHAKE_HINT" });
  expect(result.model.state).toMatchObject({
    status: "waiting",
    handshake: "unconfirmed",
    window: "open",
  });
  expect(result.effects).toEqual([
    { type: "Diagnostic", code: "handshake_missing" },
    { type: "SlowHandshake" },
  ]);
  const confirmed = run(result.model, { type: "READY", status: "valid" });
  expect(confirmed.model.state).toMatchObject({
    handshake: "confirmed",
  });
  expect(confirmed.effects).toEqual([{ type: "StopHandshake" }, { type: "StartHeartbeat" }]);
});

test.each([1000, 4000, 4001])(
  "a close before confirmation detaches and diagnoses severance at %s",
  (now) => {
    const result = run(live(), { type: "POPUP_CLOSED" }, { now });
    expect(result.model.state).toMatchObject({ status: "detached", reason: "unreachable" });
    expect(result.effects).toContainEqual({
      type: "Diagnostic",
      code: "window_closed_before_handshake",
    });
    expect(
      result.effects.some(
        (effect) => effect.type === "Diagnostic" && effect.code === "opener_severed_suspected",
      ),
    ).toBe(now <= 4000);
    expect(effects(result)).not.toContain("EndAttempt");
    expect(result.effects).toContainEqual({ type: "SetTimer", timer: "DETACHED", ms: 600 });
  },
);

test.each(["ring", "granting", undefined] as const)(
  "uses close grace for phase %s only once",
  (phase) => {
    const before = phase ? run(waiting(), { type: "STATUS", phase }).model : waiting();
    const closed = run(before, { type: "POPUP_CLOSED" });
    expect(closed.model.state).toMatchObject({ status: "waiting", window: "closed" });
    expect(closed.effects).toEqual([
      { type: "SetTimer", timer: "CLOSED_GRACE", ms: phase === "ring" ? 90 : 25 },
    ]);
    expect(run(closed.model, { type: "POPUP_CLOSED" }).effects).toEqual([]);
    const ended = run(closed.model, { type: "CLOSED_GRACE" });
    expect(errorCode(ended.model)).toBe("popup_closed");
    expect(
      ended.model.state.status === "failed" && ended.model.state.error.detail?.handshake,
    ).toBeUndefined();
  },
);

test("an unconfirmed waiting close records its handshake detail after grace", () => {
  const closed = run(waiting(false, C), { type: "POPUP_CLOSED" }).model;
  expect(run(closed, { type: "CLOSED_GRACE" }).model.state).toMatchObject({
    error: { detail: { handshake: "unconfirmed" } },
  });
});

test("reopens with the same flow and attempt, a fresh generation and the old window closed", () => {
  const before = run(waiting(), { type: "POPUP_CLOSED" }).model;
  const result = run(before, { type: "REOPEN", popup: W2 });
  expect(result.model.flow).toBe(before.flow);
  expect(result.model.generation).toBe(1);
  expect(result.model.state).toMatchObject({ status: "opening", attemptId: CTX.attemptId });
  expect(result.effects).toEqual([
    { type: "ClosePopup", popup: W },
    { type: "WatchPopup", popup: W2 },
    {
      type: "StartHandshake",
      popup: W2,
      origin: D.origin,
      attemptId: CTX.attemptId,
      flowId: expect.any(Number),
    },
    { type: "SetTimer", timer: "HANDSHAKE_HINT", ms: 15 },
    { type: "ClearTimer", timers: ["CLOSED_GRACE", "DETACHED"] },
  ]);
  expect(effects(result)).not.toContain("CreateFlow");
});

test("focus and status only affect an eligible waiting window", () => {
  expect(run(waiting(), { type: "FOCUS" }).effects).toEqual([{ type: "FocusPopup", popup: W }]);
  expect(run(start(), { type: "STATUS", phase: "ring" }).effects).toEqual([]);
  const closed = run(waiting(), { type: "POPUP_CLOSED" }).model;
  expect(run(closed, { type: "FOCUS" }).effects).toEqual([]);
});

test.each(["success", "cancel", "error"] as const)(
  "processes the first %s outcome, then only acknowledges repeats",
  (outcome) => {
    const result = run(waiting(), {
      type: "OUTCOME",
      outcome,
      code: "storage_unavailable",
      messageId: "one",
      version: 2,
    });
    expect(result.effects[0]).toEqual({ type: "Ack", messageId: "one", version: 2 });
    expect(result.model.state.status).toBe(outcome === "success" ? "finishing" : "failed");
    if (outcome === "error")
      expect(result.model.state).toMatchObject({
        error: { code: "passport_error", detail: { passportCode: "storage_unavailable" } },
      });
    if (outcome === "cancel")
      expect(result.model.state).toMatchObject({
        error: { code: "cancelled", detail: { by: "user" } },
      });
    expect(result.model.state.status).not.toBe("signed-in");
    const repeated = run(result.model, {
      type: "OUTCOME",
      outcome: "cancel",
      messageId: "two",
      version: 1,
    });
    expect(repeated.model).toBe(result.model);
    expect(repeated.effects).toEqual([{ type: "Ack", messageId: "two", version: 1 }]);
  },
);

test.each(["FINISHING_TIMEOUT", "DETACHED_TIMEOUT", "ATTEMPT_TIMEOUT"] as const)(
  "ends the matching %s state once",
  (type) => {
    const before =
      type === "FINISHING_TIMEOUT"
        ? run(waiting(), { type: "OUTCOME", outcome: "success", messageId: "one", version: 2 })
            .model
        : type === "DETACHED_TIMEOUT"
          ? run(live(), { type: "POPUP_CLOSED" }).model
          : start();
    const result = run(before, { type });
    expect(errorCode(result.model)).toBe("timeout");
    expect(effects(result).filter((x) => x === "EndAttempt")).toHaveLength(1);
    expect(run(result.model, { type }).effects).toEqual([]);
  },
);

test.each([false, true])(
  "pagehide closes only a non-persisted popup document (%s)",
  (persisted) => {
    const before = waiting();
    const result = run(before, { type: "PAGE_HIDE", persisted });
    expect(result.model).toBe(before);
    expect(result.effects).toEqual(persisted ? [] : [{ type: "ClosePopup", popup: W }]);
  },
);

test("switches to default using a fresh flow without sharing the custom flow's secret", () => {
  const before = waiting(false, C);
  const result = run(before, { type: "USE_DEFAULT_INSTANCE", popup: W2 });
  expect(result.model.state).toEqual({ status: "opening", instance: D, attemptId: CTX.attemptId });
  expect(result.model.flow).not.toBe(before.flow);
  expect(result.model.selection).toBe(C);
  expect(result.model.flows.get(before.flow!)?.endedBy).toBe("abandoned");
  expect(result.model.flows.get(before.flow!)?.instance).toBe(C);
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
  expect(result.effects).toContainEqual({
    type: "CreateFlow",
    flowId: result.model.flow,
    instance: D,
  });
  expect(effects(result)).not.toContain("RetireFlow");
});

test("failed custom use-default starts a new attempt and default pin", () => {
  const failed = run(start(C), { type: "ATTEMPT_TIMEOUT" }).model;
  const result = run(
    failed,
    { type: "USE_DEFAULT_INSTANCE", popup: W2 },
    { attemptId: "fresh-attempt-0123456789" },
  );
  expect(result.model.state).toMatchObject({ attemptId: "fresh-attempt-0123456789", instance: D });
  expect(run(waiting(), { type: "USE_DEFAULT_INSTANCE", popup: W2 }).effects).toEqual([]);
});

test("use-default and reopen keep window generations increasing within the same attempt", () => {
  const changed = run(waiting(false, C), { type: "USE_DEFAULT_INSTANCE", popup: W2 }).model;
  expect(changed.generation).toBe(1);
  const created = run(changed, {
    type: "FLOW_CREATED",
    flowId: changed.flow!,
    ringLink: LINK,
  }).model;
  const closed = run(created, { type: "POPUP_CLOSED" }).model;
  expect(run(closed, { type: "REOPEN", popup: W }).model.generation).toBe(2);
});

test("app cancellation restores the selection but formats its result with the attempt pin", () => {
  const changed = run(waiting(false, C), { type: "USE_DEFAULT_INSTANCE", popup: W2 }).model;
  const result = run(
    changed,
    { type: "CANCEL" },
    { messages: { "error.cancelled": "Cancelled at {instanceHost}" } },
  );
  expect(result.model.state.instance).toBe(C);
  expect(result.effects).toContainEqual(
    expect.objectContaining({
      type: "EndAttempt",
      error: expect.objectContaining({ message: "Cancelled at default.example" }),
    }),
  );
});

test("passively ending an exposed flow drains it, but app cancellation frees it", () => {
  const before = run(prepared(), { type: "SIGN_IN", popup: W, instance: D }).model;
  const failed = run(before, { type: "ATTEMPT_TIMEOUT" });
  expect(failed.effects).toContainEqual({ type: "RetireFlow", flowId: before.flow, ms: 90 });
  expect(failed.model.flows.get(before.flow!)?.endedBy).toBe("passive");
  const cancelled = run(before, { type: "CANCEL" });
  expect(cancelled.model.state).toEqual({ status: "idle", instance: D });
  expect(cancelled.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
  expect(cancelled.model.flows.get(before.flow!)?.endedBy).toBe("app");
  expect(cancelled.effects).toContainEqual(
    expect.objectContaining({
      type: "EndAttempt",
      error: expect.objectContaining({ code: "cancelled", detail: { by: "app" } }),
    }),
  );
});

test("reset preserves the stored selection and invalidates pending drains; live reset does nothing", () => {
  const before = run(waiting(false, C), { type: "USE_DEFAULT_INSTANCE", popup: W2 }).model;
  expect(run(before, { type: "RESET" }).model).toBe(before);
  const failed = run(before, { type: "ATTEMPT_TIMEOUT" }).model;
  const reset = run(failed, { type: "RESET" });
  expect(reset.model.state).toEqual({ status: "idle", instance: C });
  expect([...reset.model.flows.values()].every((flow) => flow.endedBy === "app")).toBe(true);
});

test("dispose ends once and never restarts work; unexpected created flows are freed", () => {
  const before = start();
  const disposed = run(before, { type: "DISPOSE" });
  expect(disposed.model.disposed).toBe(true);
  expect(effects(disposed).filter((x) => x === "EndAttempt")).toHaveLength(1);
  expect(run(disposed.model, { type: "DISPOSE" }).effects).toEqual([]);
  expect(run(disposed.model, { type: "SIGN_IN", popup: W2, instance: D }).effects).toEqual([]);
  expect(
    run(disposed.model, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK }).effects,
  ).toEqual([{ type: "FreeFlow", flowId: before.flow }]);
});

test.each([true, false])("invalid and expired ready end waiting (confirmed=%s)", (confirmed) => {
  for (const status of ["invalid", "expired"] as const) {
    const result = run(waiting(confirmed), { type: "READY", status, code: "invalid_request" });
    expect(errorCode(result.model)).toBe(
      status === "invalid" ? "request_rejected" : "request_expired",
    );
    expect(effects(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
  }
});

test("a Passport on another network ends the attempt with network_mismatch, without a retry", () => {
  const result = run(waiting(true), { type: "READY", status: "invalid", code: "network_mismatch" });
  expect(errorCode(result.model)).toBe("network_mismatch");
  expect(effects(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
});

test.each([
  ["creating", () => start(C)],
  ["opening", () => live(C)],
  ["unconfirmed", () => waiting(false, C)],
  ["confirmed", () => waiting(true, C)],
  ["granting", () => run(waiting(true, C), { type: "STATUS", phase: "granting" }).model],
  ["closed", () => run(waiting(true, C), { type: "POPUP_CLOSED" }).model],
  ["unreachable", () => run(live(C), { type: "POPUP_CLOSED" }).model],
  ["request lost", () => run(waiting(true, C), { type: "READY", status: "empty" }).model],
] as const)(
  "completed without an outcome ends %s once with the pinned request-ended error",
  (_name, create) => {
    const before = create();
    const result = run(before, { type: "READY", status: "completed" });
    expect(result.model.state).toMatchObject({
      status: "failed",
      instance: C,
      error: { code: "request_ended" },
    });
    expect(effects(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
    expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
    expect(result.model.flows.get(before.flow!)?.endedBy).toBe("passive");
    expect(run(result.model, { type: "READY", status: "completed" })).toEqual({
      model: result.model,
      effects: [],
    });
    expect(JSON.stringify(result)).not.toContain("private-canary");
  },
);

test.each([true, false])(
  "completed in the Ring phase keeps polling and the same close grace (confirmed=%s)",
  (confirmed) => {
    const open = run(waiting(confirmed), { type: "STATUS", phase: "ring" }).model;
    const closed = run(open, { type: "POPUP_CLOSED" });
    expect(closed.effects).toEqual([{ type: "SetTimer", timer: "CLOSED_GRACE", ms: 90 }]);
    for (const before of [open, closed.model]) {
      expect(run(before, { type: "READY", status: "completed" })).toEqual({
        model: before,
        effects: [],
      });
      expect(before.flows.get(before.flow!)?.status).toBe("polling");
    }
    const elapsed = run(closed.model, { type: "CLOSED_GRACE" });
    expect(errorCode(elapsed.model)).toBe("popup_closed");
    expect(effects(elapsed).filter((type) => type === "EndAttempt")).toHaveLength(1);
  },
);

test("completed preserves a shown QR drain and retry creates a new flow", () => {
  const before = run(prepared(), { type: "SIGN_IN", popup: W, instance: D }).model;
  const ended = run(before, { type: "READY", status: "completed" });
  expect(errorCode(ended.model)).toBe("request_ended");
  expect(ended.effects).toContainEqual({ type: "RetireFlow", flowId: before.flow, ms: 90 });
  expect(ended.effects).not.toContainEqual({ type: "FreeFlow", flowId: before.flow });
  const retried = run(ended.model, { type: "SIGN_IN", popup: W2, instance: D });
  expect(retried.model.flow).not.toBe(before.flow);
  expect(retried.effects).toContainEqual({
    type: "CreateFlow",
    flowId: retried.model.flow,
    instance: D,
  });
});

test("request-ended copy uses the configured override and the attempt pin", () => {
  const result = run(
    waiting(true, C),
    { type: "READY", status: "completed" },
    {
      appName: "App",
      messages: { "error.request_ended": "Ended at {instanceHost} for {appName}." },
    },
  );
  expect(result.model.state).toMatchObject({
    error: { message: "Ended at custom.example for App." },
  });
});

test.each([
  ["opening", () => live()],
  ["unconfirmed", () => waiting(false)],
  ["confirmed", () => waiting()],
] as const)(
  "success while %s stops both hello modes and later completed does not replace the outcome",
  (_name, create) => {
    const result = run(create(), {
      type: "OUTCOME",
      outcome: "success",
      messageId: "one",
      version: 2,
    });
    expect(result.model.state).toMatchObject({ status: "finishing", via: "popup" });
    expect(result.effects).toContainEqual({ type: "StopHandshake" });
    expect(result.effects).toContainEqual({ type: "StopHeartbeat" });
    expect(run(result.model, { type: "READY", status: "completed" })).toEqual({
      model: result.model,
      effects: [],
    });
  },
);

test("a draining poll failure frees only its own flow and preserves the active attempt", () => {
  const active = waiting();
  const draining = {
    ...active.flows.get(active.flow!)!,
    status: "draining" as const,
    endedBy: "passive" as const,
  };
  const before = { ...active, flows: new Map([...active.flows, [99, draining]]) };
  const result = run(before, {
    type: "POLL_FAILED",
    flowId: 99,
    error: new PassportError("network"),
  });
  expect(result.model.state).toBe(before.state);
  expect(result.model.flow).toBe(before.flow);
  expect(result.effects).toEqual([{ type: "FreeFlow", flowId: 99 }]);
  expect(before.flows.get(99)).toBe(draining);
  expect(before.flows.get(99)?.status).toBe("draining");
});

test("reset is a no-op for plain idle but clears idle's last error", () => {
  const idle = createAttemptModel(C);
  expect(run(idle, { type: "RESET" })).toEqual({ model: idle, effects: [] });
  const before = {
    ...idle,
    state: { status: "idle" as const, instance: C, lastError: new PassportError("timeout") },
  };
  const result = run(before, { type: "RESET" });
  expect(result.model.state).toEqual({ status: "idle", instance: C });
  expect(result.effects).toEqual([{ type: "ClearTimer", timers: ["RING_PIN_ELAPSED"] }]);
});

test("unrelated creation failures, repeated starts and nonmatching timers are no-ops", () => {
  const before = waiting();
  for (const event of [
    { type: "FLOW_FAILED", flowId: 99, error: new PassportError("network") },
    { type: "SIGN_IN", popup: W2, instance: C },
    { type: "FINISHING_TIMEOUT" },
  ] satisfies AttemptEvent[])
    expect(run(before, event)).toEqual({ model: before, effects: [] });
});

test.each(["waiting", "detached"] as const)(
  "switching %s to the default preserves the attempt deadline",
  (status) => {
    const before =
      status === "waiting" ? waiting(false, C) : run(live(C), { type: "POPUP_CLOSED" }).model;
    const result = run(before, { type: "USE_DEFAULT_INSTANCE", popup: W2 });
    expect(result.effects).not.toContainEqual(
      expect.objectContaining({ type: "SetTimer", timer: "ATTEMPT" }),
    );
    const failed = run(before, { type: "ATTEMPT_TIMEOUT" }).model;
    expect(run(failed, { type: "USE_DEFAULT_INSTANCE", popup: W2 }).effects).toContainEqual({
      type: "SetTimer",
      timer: "ATTEMPT",
      ms: CTX.timeouts.attemptMs,
    });
  },
);

for (const creating of [true, false]) {
  for (const [oldInstance, newInstance] of [
    [C, D],
    [D, C],
  ] as const) {
    test(`changing ${creating ? "preparing" : "ready"} from ${oldInstance.host} to ${newInstance.host} creates a freshly pinned flow`, () => {
      const before = prepared(creating, oldInstance);
      const previousFlow = before.flows.get(before.flow!)!;
      const result = run(before, { type: "SIGN_IN", popup: W2, instance: newInstance });
      const old = result.model.flows.get(before.flow!)!;
      expect(old.instance).toBe(oldInstance);
      expect(old.attemptId).toBe(previousFlow.attemptId);
      expect(old.endedBy).toBe(creating ? "abandoned" : "passive");
      expect(old.status).toBe(creating ? "freeing" : "draining");
      expect(before.flows.get(before.flow!)).toBe(previousFlow);
      expect(result.model.flow).not.toBe(before.flow);
      expect(result.effects).toEqual([
        creating
          ? { type: "FreeFlow", flowId: before.flow }
          : { type: "RetireFlow", flowId: before.flow, ms: 90 },
        { type: "CreateFlow", flowId: result.model.flow, instance: newInstance },
        { type: "WatchPopup", popup: W2 },
        { type: "SetTimer", timer: "ATTEMPT", ms: 1800 },
        { type: "ClearTimer", timers: [creating ? "PREPARE_RETRY" : "RING_ROTATE"] },
      ]);
      const created = run(result.model, {
        type: "FLOW_CREATED",
        flowId: result.model.flow!,
        ringLink: LINK,
      });
      expect(created.effects).toEqual([
        {
          type: "NavigatePopup",
          popup: W2,
          flowId: result.model.flow,
          origin: newInstance.origin,
        },
        { type: "StartPolling", flowId: result.model.flow },
        {
          type: "StartHandshake",
          popup: W2,
          origin: newInstance.origin,
          attemptId: CTX.attemptId,
          flowId: expect.any(Number),
        },
        { type: "SetTimer", timer: "HANDSHAKE_HINT", ms: 15 },
      ]);
    });
  }
}

test("same-origin adoption preserves the flow's immutable instance metadata", () => {
  const before = prepared(false, C);
  const selected = { ...C };
  const result = run(
    before,
    { type: "SIGN_IN", popup: W, instance: selected },
    { attemptId: "fresh-attempt-0123456789" },
  );
  expect(result.model.flow).toBe(before.flow);
  expect(result.model.flows.get(before.flow!)?.instance).toBe(C);
  expect(result.model.flows.get(before.flow!)?.attemptId).toBe("fresh-attempt-0123456789");
});

test.each(["waiting", "detached"] as const)(
  "default fallback from %s closes and stops the old popup before creating its replacement",
  (status) => {
    const before =
      status === "waiting" ? waiting(false, C) : run(live(C), { type: "POPUP_CLOSED" }).model;
    const result = run(before, { type: "USE_DEFAULT_INSTANCE", popup: W2 });
    expect(result.effects).toEqual([
      { type: "ClosePopup", popup: W },
      { type: "StopHandshake" },
      { type: "StopHeartbeat" },
      { type: "FreeFlow", flowId: before.flow },
      { type: "CreateFlow", flowId: result.model.flow, instance: D },
      { type: "WatchPopup", popup: W2 },
    ]);
    const created = run(result.model, {
      type: "FLOW_CREATED",
      flowId: result.model.flow!,
      ringLink: LINK,
    });
    expect(created.effects).toEqual([
      { type: "NavigatePopup", popup: W2, flowId: result.model.flow, origin: D.origin },
      { type: "StartPolling", flowId: result.model.flow },
      {
        type: "StartHandshake",
        popup: W2,
        origin: D.origin,
        attemptId: CTX.attemptId,
        flowId: expect.any(Number),
      },
      { type: "SetTimer", timer: "HANDSHAKE_HINT", ms: 15 },
    ]);
  },
);

function passiveDrain() {
  const adopted = run(prepared(false, C), { type: "SIGN_IN", popup: W, instance: C }).model;
  const failed = run(adopted, { type: "ATTEMPT_TIMEOUT" }).model;
  expect(failed.flows.get(adopted.flow!)?.status).toBe("draining");
  return { model: failed, flowId: adopted.flow! };
}

test.each(["failed", "signed-in"] as const)(
  "reset from %s frees a real passive drain and marks its late Sessions app-ended",
  (status) => {
    const drain = passiveDrain();
    const before =
      status === "failed"
        ? drain.model
        : {
            ...drain.model,
            state: {
              status,
              instance: C,
              attemptId: CTX.attemptId,
              publicKey: "public-key",
              via: "ring" as const,
            },
          };
    const result = run(before, { type: "RESET" });
    expect(result.model.state).toEqual({ status: "idle", instance: C });
    expect(result.model.flows.get(drain.flowId)).toMatchObject({
      status: "freeing",
      endedBy: "app",
      instance: C,
    });
    expect(result.effects).toEqual([
      { type: "FreeFlow", flowId: drain.flowId },
      { type: "ClearTimer", timers: ["RING_PIN_ELAPSED"] },
    ]);
  },
);

test("dispose frees an earlier passive drain as well as ending the current state", () => {
  const drain = passiveDrain();
  const result = run(drain.model, { type: "DISPOSE" });
  expect(result.model.disposed).toBe(true);
  expect(result.model.flows.get(drain.flowId)).toMatchObject({ status: "freeing", endedBy: "app" });
  expect(result.effects).toEqual([
    {
      type: "EndAttempt",
      by: "app",
      error: expect.objectContaining({ code: "cancelled", detail: { by: "app" } }),
    },
    { type: "FreeFlow", flowId: drain.flowId },
  ]);
});

test.each(["detached", "closed"] as const)(
  "success from %s clears both close and detached deadlines",
  (source) => {
    const before =
      source === "detached"
        ? run(live(), { type: "POPUP_CLOSED" }).model
        : run(waiting(), { type: "POPUP_CLOSED" }).model;
    const result = run(before, {
      type: "OUTCOME",
      outcome: "success",
      messageId: "one",
      version: 2,
    });
    expect(result.model.state).toEqual({
      status: "finishing",
      instance: D,
      attemptId: CTX.attemptId,
      via: "popup",
    });
    expect(result.effects).toEqual([
      { type: "Ack", messageId: "one", version: 2 },
      { type: "StopHandshake" },
      { type: "StopHeartbeat" },
      { type: "ClearTimer", timers: ["CLOSED_GRACE", "DETACHED"] },
      { type: "SetTimer", timer: "FINISHING", ms: 60 },
    ]);
  },
);

test("cancellation from detached acknowledges, frees and ends once", () => {
  const before = run(live(), { type: "POPUP_CLOSED" }).model;
  const result = run(before, { type: "OUTCOME", outcome: "cancel", messageId: "one", version: 2 });
  expect(result.model.state).toMatchObject({
    status: "failed",
    error: { code: "cancelled", detail: { by: "user" } },
  });
  expect(result.effects).toEqual([
    { type: "Ack", messageId: "one", version: 2 },
    { type: "FreeFlow", flowId: before.flow },
    {
      type: "EndAttempt",
      by: "passive",
      error: expect.objectContaining({ code: "cancelled", detail: { by: "user" } }),
    },
  ]);
});

test("close grace while the window remains open is a no-op", () => {
  const before = waiting();
  expect(run(before, { type: "CLOSED_GRACE" })).toEqual({ model: before, effects: [] });
});

test.each([
  ["opening", () => start()],
  ["waiting", () => waiting()],
  ["detached", () => run(live(), { type: "POPUP_CLOSED" }).model],
  [
    "finishing",
    () =>
      run(waiting(), { type: "OUTCOME", outcome: "success", messageId: "one", version: 2 }).model,
  ],
] as const)(
  "an active poll failure in %s frees its flow and ends with the mapped error",
  (_name, create) => {
    const before = create();
    const error = new PassportError("network");
    const result = run(before, { type: "POLL_FAILED", flowId: before.flow!, error });
    expect(result.model.state).toMatchObject({ status: "failed", error });
    expect(result.effects).toEqual([
      { type: "FreeFlow", flowId: before.flow },
      { type: "EndAttempt", by: "passive", error },
    ]);
  },
);

test.each(["opening", "detached"] as const)(
  "pagehide in %s closes only for a non-persisted page",
  (source) => {
    const before = source === "opening" ? start() : run(live(), { type: "POPUP_CLOSED" }).model;
    for (const persisted of [true, false])
      expect(run(before, { type: "PAGE_HIDE", persisted })).toEqual({
        model: before,
        effects: persisted ? [] : [{ type: "ClosePopup", popup: W }],
      });
  },
);

test("detached timeout outside detached never changes the state or emits effects", () => {
  for (const before of [
    createAttemptModel(D),
    prepared(true),
    prepared(),
    start(),
    live(),
    waiting(),
    run(start(), { type: "ATTEMPT_TIMEOUT" }).model,
  ]) {
    expect(run(before, { type: "DETACHED_TIMEOUT" })).toEqual({ model: before, effects: [] });
  }
});

test.each([true, false])(
  "cancelling a prepared lease (creating=%s) frees it without a drain",
  (creating) => {
    const before = prepared(creating);
    const result = run(before, { type: "CANCEL" });
    expect(result.model.state).toEqual({ status: "idle", instance: D });
    expect(result.model.flows.get(before.flow!)).toMatchObject({
      status: "freeing",
      endedBy: "app",
    });
    expect(result.effects).toEqual([
      { type: "FreeFlow", flowId: before.flow },
      {
        type: "EndAttempt",
        by: "app",
        error: expect.objectContaining({ code: "cancelled", detail: { by: "app" } }),
      },
    ]);
  },
);

const UNREACHABLE_SOURCES = ["idle", "failed", "signed-in", "preparing", "ready"] as const;

function unreachableSource(source: (typeof UNREACHABLE_SOURCES)[number]): AttemptModel {
  switch (source) {
    case "idle":
      return createAttemptModel(C);
    case "failed":
      return run(start(C), { type: "ATTEMPT_TIMEOUT" }).model;
    case "signed-in":
      return {
        ...createAttemptModel(C),
        state: {
          status: "signed-in",
          instance: C,
          attemptId: "prior-attempt",
          publicKey: "public-key",
        },
      };
    case "preparing":
      return prepared(true, C);
    case "ready":
      return prepared(false, C);
  }
}

for (const source of UNREACHABLE_SOURCES) {
  test(`an unreachable popup from ${source} keeps a callback-free attempt and detaches when polling`, () => {
    const before = unreachableSource(source);
    const adopted = source === "preparing" || source === "ready";
    const polling = source === "ready";
    const result = run(before, { type: "SIGN_IN", popup: undefined, instance: C });
    const attemptId = CTX.attemptId;
    expect(result.model.state).toEqual(
      polling
        ? { status: "detached", instance: C, attemptId, reason: "unreachable", ringLink: LINK }
        : { status: "opening", instance: C, attemptId },
    );
    expect(result.model).not.toHaveProperty("popup");
    expect(result.model.selection).toBe(C);
    expect(result.model.flow === before.flow).toBe(adopted);
    expect(result.effects).toEqual([
      ...(!adopted ? [{ type: "CreateFlow", flowId: result.model.flow, instance: C }] : []),
      ...(polling ? [{ type: "SetTimer", timer: "DETACHED", ms: 600 }] : []),
      { type: "SetTimer", timer: "ATTEMPT", ms: 1800 },
      { type: "ClearTimer", timers: ["PREPARE_RETRY", "RING_ROTATE"] },
    ]);
    if (!polling) {
      expect(run(result.model, { type: "FOCUS" })).toEqual({ model: result.model, effects: [] });
      expect(run(result.model, { type: "SIGN_IN", popup: undefined, instance: D })).toEqual({
        model: result.model,
        effects: [],
      });
      const created = run(result.model, {
        type: "FLOW_CREATED",
        flowId: result.model.flow!,
        ringLink: LINK,
      });
      expect(created.model.state).toEqual({
        status: "detached",
        instance: C,
        attemptId,
        reason: "unreachable",
        ringLink: LINK,
      });
      expect(created.effects).toEqual([
        { type: "StartPolling", flowId: result.model.flow },
        { type: "SetTimer", timer: "DETACHED", ms: 600 },
      ]);
    }
  });
}

test.each([true, false])(
  "unreachable starts still replace a foreign preparation (creating=%s)",
  (creating) => {
    const before = prepared(creating, C);
    const result = run(before, { type: "SIGN_IN", popup: undefined, instance: D });
    expect(result.model.state).toEqual({
      status: "opening",
      instance: D,
      attemptId: CTX.attemptId,
    });
    expect(result.model.flows.get(before.flow!)?.instance).toBe(C);
    expect(result.model.flows.get(before.flow!)?.endedBy).toBe(creating ? "abandoned" : "passive");
    expect(result.effects).toEqual([
      creating
        ? { type: "FreeFlow", flowId: before.flow }
        : { type: "RetireFlow", flowId: before.flow, ms: 90 },
      { type: "CreateFlow", flowId: result.model.flow, instance: D },
      { type: "SetTimer", timer: "ATTEMPT", ms: 1800 },
      { type: "ClearTimer", timers: ["PREPARE_RETRY", "RING_ROTATE"] },
    ]);
  },
);

test("a windowless creation can fail or cancel and a detached result can reopen normally", () => {
  const opening = run(createAttemptModel(C), {
    type: "SIGN_IN",
    popup: undefined,
    instance: C,
  }).model;
  const error = new PassportError("network");
  expect(
    run(opening, { type: "FLOW_FAILED", flowId: opening.flow!, error }).model.state,
  ).toMatchObject({ status: "failed", error });
  const cancelled = run(opening, { type: "CANCEL" });
  expect(cancelled.model.state.status).toBe("idle");
  expect(cancelled.effects).toEqual([
    { type: "FreeFlow", flowId: opening.flow },
    { type: "EndAttempt", by: "app", error: expect.objectContaining({ code: "cancelled" }) },
  ]);
  const detached = run(opening, {
    type: "FLOW_CREATED",
    flowId: opening.flow!,
    ringLink: LINK,
  }).model;
  expect(run(detached, { type: "DETACHED_TIMEOUT" }).model.state).toMatchObject({
    status: "failed",
    error: { code: "timeout" },
  });
  const reopened = run(detached, { type: "REOPEN", popup: W2 });
  expect(reopened.model.state.status).toBe("opening");
  expect(reopened.model.flow).toBe(opening.flow);
  expect(reopened.effects).toEqual([
    { type: "WatchPopup", popup: W2 },
    {
      type: "StartHandshake",
      popup: W2,
      origin: C.origin,
      attemptId: CTX.attemptId,
      flowId: expect.any(Number),
    },
    { type: "SetTimer", timer: "HANDSHAKE_HINT", ms: 15 },
    { type: "ClearTimer", timers: ["CLOSED_GRACE", "DETACHED"] },
  ]);
});
