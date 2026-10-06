// @vitest-environment node
import { expect, test } from "vitest";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { PassportError } from "../errors/PassportError.js";
import { createRingLink } from "../shared/RingLink.js";
import { attemptMachine } from "./attemptMachine.js";
import {
  createAttemptModel,
  type AttemptContext,
  type AttemptEvent,
  type AttemptModel,
} from "./attemptModel.js";

const INSTANCE = Object.freeze({
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
});
const WINDOW = Object.freeze({ name: "lease-popup" }) as unknown as Window;
const LINK = createRingLink(() => "pubkyauth://" + "lease-private-canary");
const ERROR = new PassportError("network");
const DEFAULT_TIMEOUTS = resolveClientOptions({}, (value) => value).timeouts;
const CONTEXT: AttemptContext = {
  defaultInstance: INSTANCE,
  attemptId: "lease-attempt-0123456789",
  now: 1000,
  profile: "optional",
  timeouts: DEFAULT_TIMEOUTS,
  leases: 1,
  visible: true,
};
const run = (model: AttemptModel, event: AttemptEvent, context: Partial<AttemptContext> = {}) =>
  attemptMachine(model, event, { ...CONTEXT, ...context });
const idle = () => createAttemptModel(INSTANCE);
const preparing = () => run(idle(), { type: "PREPARE" }).model;
const ready = () => {
  const before = preparing();
  return run(before, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK }).model;
};
const types = (result: ReturnType<typeof run>) => result.effects.map((effect) => effect.type);

test.each(["idle", "failed"] as const)(
  "prepares one callback-free flow from %s with a lease",
  (status) => {
    const base = idle();
    const before =
      status === "idle"
        ? base
        : { ...base, state: { status, instance: INSTANCE, attemptId: "old", error: ERROR } };
    const result = run(before, { type: "PREPARE" });
    expect(result.model.state).toEqual({
      status: "preparing",
      instance: INSTANCE,
      ...(status === "failed" ? { lastError: ERROR } : {}),
    });
    expect(result.effects).toContainEqual({
      type: "CreateFlow",
      flowId: result.model.flow,
      instance: INSTANCE,
    });
    expect(result.model.flows.get(result.model.flow!)?.exposed).toBe(false);
    expect(run(before, { type: "PREPARE" }, { leases: 0 })).toEqual({ model: before, effects: [] });
    expect(run(result.model, { type: "PREPARE" }).effects).toEqual([]);
  },
);

test("a created preparation becomes ready, polls once and schedules rotation", () => {
  const before = preparing();
  const result = run(before, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK });
  expect(result.model.state).toEqual({ status: "ready", instance: INSTANCE, ringLink: LINK });
  expect(result.effects).toContainEqual({ type: "StartPolling", flowId: before.flow });
  expect(result.effects).toContainEqual({
    type: "SetTimer",
    timer: "RING_ROTATE",
    ms: DEFAULT_TIMEOUTS.ringLinkRotateMs,
  });
  expect(result.model.flows.get(before.flow!)?.exposed).toBe(true);
  expect(JSON.stringify(result.model.state)).not.toContain("lease-private-canary");
});

test("preparation failures retain the error and retry at 5s, 30s and capped 2min", () => {
  let model = preparing();
  for (const ms of [5000, 30000, 120000, 120000]) {
    const failed = run(model, { type: "FLOW_FAILED", flowId: model.flow!, error: ERROR });
    expect(failed.model.state).toEqual({ status: "idle", instance: INSTANCE, lastError: ERROR });
    expect(failed.effects).toContainEqual({ type: "SetTimer", timer: "PREPARE_RETRY", ms });
    expect(run(failed.model, { type: "PREPARE_RETRY" }, { leases: 0 }).model).toBe(failed.model);
    model = run(failed.model, { type: "PREPARE_RETRY" }).model;
    expect(model.state).toEqual({ status: "preparing", instance: INSTANCE, lastError: ERROR });
  }
  const created = run(model, { type: "FLOW_CREATED", flowId: model.flow!, ringLink: LINK }).model;
  expect(created.state).toMatchObject({ status: "ready", lastError: ERROR });
  const failedAgain = run(created, { type: "POLL_FAILED", flowId: created.flow!, error: ERROR });
  expect(failedAgain.effects).toContainEqual({
    type: "SetTimer",
    timer: "PREPARE_RETRY",
    ms: 5000,
  });
});

test("visible unpinned rotation retires the old flow and creates a fresh one", () => {
  const before = ready();
  const result = run(before, { type: "RING_ROTATE" });
  expect(result.model.state.status).toBe("preparing");
  expect(result.model.flow).not.toBe(before.flow);
  expect(result.model.flows.get(before.flow!)?.status).toBe("draining");
  expect(result.effects).toContainEqual({
    type: "RetireFlow",
    flowId: before.flow,
    ms: DEFAULT_TIMEOUTS.ringGraceMs,
  });
  expect(types(result)).toContain("CreateFlow");
  expect(before.flows.get(before.flow!)?.status).toBe("polling");
});

test.each(["hidden", "pinned"] as const)(
  "rotation while %s marks it due and expired without retiring",
  (reason) => {
    const before = reason === "pinned" ? run(ready(), { type: "RING_OPENED" }).model : ready();
    const result = run(before, { type: "RING_ROTATE" }, { visible: reason !== "hidden" });
    // A62: the code is past its lifetime, so it is not shown for scanning until it is replaced.
    expect(result.model.state).toEqual({ ...before.state, expired: true });
    expect(result.model.rotateDue).toBe(true);
    expect(result.effects).toEqual([]);
  },
);

test("A62: reloading an expired code replaces it at once; a failed preparation retries now", () => {
  const before = run(run(ready(), { type: "RING_OPENED" }).model, { type: "RING_ROTATE" }).model;
  const reloaded = run(before, { type: "RING_RELOAD" });
  expect(reloaded.model.state.status).toBe("preparing");
  expect(reloaded.effects).toContainEqual({
    type: "RetireFlow",
    flowId: before.flow,
    ms: DEFAULT_TIMEOUTS.ringGraceMs,
  });
  expect(types(reloaded)).toContain("CreateFlow");
  const started = preparing();
  const failed = run(started, { type: "FLOW_FAILED", flowId: started.flow!, error: ERROR }).model;
  expect(failed.state).toMatchObject({ status: "idle", lastError: { code: "network" } });
  expect(types(run(failed, { type: "RING_RELOAD" }))).toContain("CreateFlow");
  // Without a lease nothing is prepared.
  expect(run(failed, { type: "RING_RELOAD" }, { leases: 0 }).effects).toEqual([]);
});

test("opening Ring pins for its grace and rotates a due flow only after the pin elapses", () => {
  const pinned = run(ready(), { type: "RING_OPENED" });
  expect(pinned.model.ringPinned).toBe(true);
  expect(pinned.effects).toEqual([
    { type: "SetTimer", timer: "RING_PIN_ELAPSED", ms: DEFAULT_TIMEOUTS.ringGraceMs },
  ]);
  const due = run(pinned.model, { type: "RING_ROTATE" }).model;
  const result = run(due, { type: "RING_PIN_ELAPSED" });
  expect(result.model.ringPinned).toBe(false);
  expect(result.model.state.status).toBe("preparing");
  expect(types(result)).toContain("RetireFlow");
  const hidden = run(due, { type: "RING_PIN_ELAPSED" }, { visible: false });
  expect(hidden.model.rotateDue).toBe(true);
  expect(hidden.model.ringPinned).toBe(false);
  expect(hidden.effects).toEqual([]);
});

test("hiding schedules a cap without touching the live flow; returning without rotation due clears it", () => {
  const before = ready();
  const hidden = run(before, { type: "DOCUMENT_HIDDEN" }, { visible: false });
  expect(hidden.model.state).toBe(before.state);
  expect(hidden.effects).toEqual([
    { type: "SetTimer", timer: "HIDDEN_CAP", ms: DEFAULT_TIMEOUTS.attemptMs },
  ]);
  const visible = run(hidden.model, { type: "DOCUMENT_VISIBLE" });
  expect(visible.effects).toEqual([{ type: "ClearTimer", timers: ["HIDDEN_CAP"] }]);
  expect(visible.model.state).toBe(before.state);
});

test("a preparation that finishes hidden starts its hidden cap too", () => {
  const before = preparing();
  const result = run(
    before,
    { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK },
    { visible: false },
  );
  expect(result.effects).toContainEqual({
    type: "SetTimer",
    timer: "HIDDEN_CAP",
    ms: DEFAULT_TIMEOUTS.attemptMs,
  });
});

test("the hidden cap retires an unpinned flow and visibility prepares its replacement", () => {
  const before = ready();
  const hidden = run(before, { type: "HIDDEN_CAP" }, { visible: false });
  expect(hidden.model.state).toEqual({ status: "idle", instance: INSTANCE });
  expect(types(hidden)).toContain("RetireFlow");
  expect(types(hidden)).not.toContain("CreateFlow");
  expect(run(hidden.model, { type: "DOCUMENT_VISIBLE" }).model.state.status).toBe("preparing");
  expect(run(hidden.model, { type: "DOCUMENT_VISIBLE" }, { leases: 0 }).model.state.status).toBe(
    "idle",
  );
  expect(run(before, { type: "HIDDEN_CAP" }).effects).toEqual([]);
  const pinned = run(before, { type: "RING_OPENED" }).model;
  expect(run(pinned, { type: "HIDDEN_CAP" }, { visible: false }).effects).toEqual([]);
});

test("zero-lease idle release retires ready flows, preserving an active pin", () => {
  const before = ready();
  const result = run(before, { type: "LEASE_IDLE" }, { leases: 0 });
  expect(result.model.state).toEqual({ status: "idle", instance: INSTANCE });
  expect(result.effects).toContainEqual({
    type: "RetireFlow",
    flowId: before.flow,
    ms: DEFAULT_TIMEOUTS.ringGraceMs,
  });
  expect(run(before, { type: "LEASE_IDLE" }).effects).toEqual([]);
  const pinned = run(before, { type: "RING_OPENED" }).model;
  expect(run(pinned, { type: "LEASE_IDLE" }, { leases: 0 }).effects).toEqual([]);
  const elapsed = run(pinned, { type: "RING_PIN_ELAPSED" }, { leases: 0 });
  expect(elapsed.model.state.status).toBe("idle");
  expect(types(elapsed)).toContain("RetireFlow");
});

test("zero-lease release during creation makes its later result an orphan", () => {
  const before = preparing();
  expect(run(before, { type: "LEASE_IDLE" }).effects).toEqual([]);
  const released = run(before, { type: "LEASE_IDLE" }, { leases: 0 });
  expect(released.model.state).toEqual({ status: "idle", instance: INSTANCE });
  expect(released.model.flow).toBeUndefined();
  expect(
    run(released.model, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK }).effects,
  ).toEqual([{ type: "FreeFlow", flowId: before.flow }]);
});

test("a ready poll failure frees that flow and schedules a retry with its error", () => {
  const before = ready();
  const result = run(before, { type: "POLL_FAILED", flowId: before.flow!, error: ERROR });
  expect(result.model.state).toEqual({ status: "idle", instance: INSTANCE, lastError: ERROR });
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
  expect(result.effects).toContainEqual({ type: "SetTimer", timer: "PREPARE_RETRY", ms: 5000 });
  expect(types(result)).not.toContain("RetireFlow");
});

test("a popup's created flow is marked exposed when a lease shows the same link", () => {
  for (const leases of [0, 1]) {
    const opening = run(
      idle(),
      { type: "SIGN_IN", popup: WINDOW, instance: INSTANCE },
      { leases },
    ).model;
    const created = run(
      opening,
      { type: "FLOW_CREATED", flowId: opening.flow!, ringLink: LINK },
      { leases },
    );
    expect(created.model.flows.get(opening.flow!)?.exposed).toBe(leases > 0);
  }
});

test("passive attempt end re-prepares with the last error while a lease remains", () => {
  const opening = run(ready(), { type: "SIGN_IN", popup: WINDOW, instance: INSTANCE }).model;
  const result = run(opening, { type: "ATTEMPT_TIMEOUT" });
  expect(result.model.state).toMatchObject({ status: "preparing", lastError: { code: "timeout" } });
  expect(result.model.flow).not.toBe(opening.flow);
  expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
  expect(types(result)).toContain("RetireFlow");
  expect(types(result)).toContain("CreateFlow");
});

test("app cancellation re-prepares silently, but dispose never re-prepares", () => {
  const before = ready();
  const cancelled = run(before, { type: "CANCEL" });
  expect(cancelled.model.state).toEqual({ status: "preparing", instance: INSTANCE });
  expect(types(cancelled)).toContain("FreeFlow");
  const disposed = run(before, { type: "DISPOSE" });
  expect(disposed.model.state.status).toBe("idle");
  expect(types(disposed)).not.toContain("CreateFlow");
  expect(run(disposed.model, { type: "PREPARE" }).effects).toEqual([]);
});

test("signed-in stays unprepared until reset, which clears errors and pin state", () => {
  const before = {
    ...idle(),
    ringPinned: true,
    state: {
      status: "signed-in" as const,
      instance: INSTANCE,
      attemptId: "completed-attempt",
      via: "ring" as const,
      publicKey: "public-key",
    },
  };
  expect(run(before, { type: "PREPARE" }).effects).toEqual([]);
  expect(run(before, { type: "DOCUMENT_VISIBLE" }).effects).toEqual([]);
  const reset = run(before, { type: "RESET" });
  expect(reset.model.state).toEqual({ status: "preparing", instance: INSTANCE });
  expect(reset.model.ringPinned).toBe(false);
  expect(types(reset)).toContain("CreateFlow");
});

const rotationEffects = (before: AttemptModel, after: AttemptModel) => [
  { type: "RetireFlow", flowId: before.flow, ms: DEFAULT_TIMEOUTS.ringGraceMs },
  {
    type: "ClearTimer",
    timers: ["PREPARE_RETRY", "RING_ROTATE", "RING_PIN_ELAPSED", "HIDDEN_CAP"],
  },
  { type: "CreateFlow", flowId: after.flow, instance: INSTANCE },
];
const capEffects = (before: AttemptModel) => [
  { type: "RetireFlow", flowId: before.flow, ms: DEFAULT_TIMEOUTS.ringGraceMs },
  {
    type: "ClearTimer",
    timers: ["PREPARE_RETRY", "RING_ROTATE", "RING_PIN_ELAPSED", "HIDDEN_CAP"],
  },
];

function pinnedDue() {
  const pinned = run(ready(), { type: "RING_OPENED" }).model;
  return run(pinned, { type: "RING_ROTATE" }, { visible: false }).model;
}

test("visibility carries out exactly one deferred rotation and leaves the old QR draining", () => {
  const before = ready();
  const due = run(before, { type: "RING_ROTATE" }, { visible: false });
  expect(due.effects).toEqual([]);
  expect(due.model.rotateDue).toBe(true);
  const visible = run(due.model, { type: "DOCUMENT_VISIBLE" });
  expect(visible.model.state.status).toBe("preparing");
  expect(visible.model.flows.get(before.flow!)).toMatchObject({
    status: "draining",
    endedBy: "passive",
    instance: INSTANCE,
  });
  expect(visible.model.flow).not.toBe(before.flow);
  expect(visible.effects).toEqual(rotationEffects(before, visible.model));
  expect(run(visible.model, { type: "DOCUMENT_VISIBLE" })).toEqual({
    model: visible.model,
    effects: [],
  });
});

test("visibility while pinned clears only the cap, then visible pin expiry rotates once", () => {
  const before = pinnedDue();
  const visible = run(before, { type: "DOCUMENT_VISIBLE" });
  expect(visible.model.state).toBe(before.state);
  expect(visible.model.ringPinned).toBe(true);
  expect(visible.model.rotateDue).toBe(true);
  expect(visible.effects).toEqual([{ type: "ClearTimer", timers: ["HIDDEN_CAP"] }]);
  const elapsed = run(visible.model, { type: "RING_PIN_ELAPSED" });
  expect(elapsed.effects).toEqual(rotationEffects(before, elapsed.model));
  expect(run(elapsed.model, { type: "RING_PIN_ELAPSED" }).effects).toEqual([]);
});

test.each(["visibility first", "pin expiry first"] as const)(
  "overdue pinned rotation happens once with %s",
  (order) => {
    const before = pinnedDue();
    const first =
      order === "visibility first"
        ? run(before, { type: "DOCUMENT_VISIBLE" })
        : run(before, { type: "RING_PIN_ELAPSED" }, { visible: false });
    const second =
      order === "visibility first"
        ? run(first.model, { type: "RING_PIN_ELAPSED" })
        : run(first.model, { type: "DOCUMENT_VISIBLE" });
    expect(first.effects.some((effect) => effect.type === "RetireFlow")).toBe(false);
    expect(second.effects).toEqual(rotationEffects(before, second.model));
    expect(second.model.state.status).toBe("preparing");
  },
);

test.each(["visibility first", "rotation timer first"] as const)(
  "overdue unpinned rotation happens once with %s",
  (order) => {
    const before = ready();
    const first =
      order === "visibility first"
        ? run(before, { type: "DOCUMENT_VISIBLE" })
        : run(before, { type: "RING_ROTATE" }, { visible: false });
    const second =
      order === "visibility first"
        ? run(first.model, { type: "RING_ROTATE" }, { visible: true })
        : run(first.model, { type: "DOCUMENT_VISIBLE" });
    expect(second.effects).toEqual(rotationEffects(before, second.model));
    expect(run(second.model, { type: "RING_ROTATE" }).effects).toEqual([]);
  },
);

test("a due hidden flow is capped once and the next visibility event prepares", () => {
  const before = run(ready(), { type: "RING_ROTATE" }, { visible: false }).model;
  const capped = run(before, { type: "HIDDEN_CAP" }, { visible: false });
  expect(capped.effects).toEqual(capEffects(before));
  expect(capped.model.hiddenCapped).toBe(true);
  expect(capped.model.state.status).toBe("idle");
  expect(run(capped.model, { type: "RING_ROTATE" }, { visible: false }).effects).toEqual([]);
  expect(run(capped.model, { type: "HIDDEN_CAP" }, { visible: false }).effects).toEqual([]);
  const visible = run(capped.model, { type: "DOCUMENT_VISIBLE" });
  expect(visible.model.state.status).toBe("preparing");
  expect(visible.effects).toEqual(rotationEffects(before, visible.model).slice(1));
  expect(visible.model).toMatchObject({ ringPinned: false, rotateDue: false, capDue: false });
});

test.each([WINDOW, undefined])(
  "popup adoption clears deferred lease flags and ignores later lease timers (window=%s)",
  (popup) => {
    const capped = run(pinnedDue(), { type: "HIDDEN_CAP" }, { visible: false }).model;
    expect(capped.capDue).toBe(true);
    const adopted = run(capped, { type: "SIGN_IN", popup, instance: INSTANCE }).model;
    expect(adopted.flow).toBe(capped.flow);
    expect(adopted).toMatchObject({ ringPinned: false, rotateDue: false, capDue: false });
    for (const visible of [true, false]) {
      for (const type of [
        "DOCUMENT_VISIBLE",
        "RING_PIN_ELAPSED",
        "RING_ROTATE",
        "HIDDEN_CAP",
      ] as const) {
        expect(run(adopted, { type }, { visible })).toEqual({ model: adopted, effects: [] });
      }
    }
    expect(adopted.flows.get(adopted.flow!)?.status).toBe("polling");
  },
);

test("a hidden cap shorter than the Ring pin is remembered until hidden pin expiry", () => {
  const timeouts = { ...DEFAULT_TIMEOUTS, attemptMs: 60_000 };
  const before = run(ready(), { type: "RING_OPENED" }).model;
  expect(timeouts.attemptMs).toBeLessThan(timeouts.ringGraceMs);
  expect(run(before, { type: "DOCUMENT_HIDDEN" }, { visible: false, timeouts }).effects).toEqual([
    { type: "SetTimer", timer: "HIDDEN_CAP", ms: 60_000 },
  ]);
  const cap = run(before, { type: "HIDDEN_CAP" }, { visible: false, timeouts });
  expect(cap.model.capDue).toBe(true);
  expect(cap.effects).toEqual([]);
  const expired = run(cap.model, { type: "RING_PIN_ELAPSED" }, { visible: false, timeouts });
  expect(expired.effects).toEqual(capEffects(before));
  expect(expired.model).toMatchObject({ hiddenCapped: true, capDue: false, ringPinned: false });
  expect(expired.model.state.status).toBe("idle");
  expect(run(expired.model, { type: "RING_PIN_ELAPSED" }, { visible: false }).effects).toEqual([]);
  expect(run(expired.model, { type: "DOCUMENT_VISIBLE" }).model.state.status).toBe("preparing");
});

test("ending a hidden period clears its deferred cap before a new hidden period", () => {
  const before = run(ready(), { type: "RING_OPENED" }).model;
  const cap = run(before, { type: "HIDDEN_CAP" }, { visible: false }).model;
  expect(cap.capDue).toBe(true);
  const visible = run(cap, { type: "DOCUMENT_VISIBLE" });
  expect(visible.model.capDue).toBe(false);
  expect(visible.effects).toEqual([{ type: "ClearTimer", timers: ["HIDDEN_CAP"] }]);
  const hiddenAgain = run(visible.model, { type: "DOCUMENT_HIDDEN" }, { visible: false });
  expect(hiddenAgain.effects).toEqual([
    { type: "SetTimer", timer: "HIDDEN_CAP", ms: DEFAULT_TIMEOUTS.attemptMs },
  ]);
  const unpinned = run(hiddenAgain.model, { type: "RING_PIN_ELAPSED" }, { visible: false });
  expect(unpinned.effects).toEqual([]);
  expect(unpinned.model.state.status).toBe("ready");
  const newCap = run(unpinned.model, { type: "HIDDEN_CAP" }, { visible: false });
  expect(newCap.effects).toEqual(capEffects(before));
});

test.each([true, false])(
  "zero leases take precedence over deferred rotation or cap (visible=%s)",
  (visible) => {
    const capped = run(pinnedDue(), { type: "HIDDEN_CAP" }, { visible: false }).model;
    const result = run(capped, { type: "RING_PIN_ELAPSED" }, { visible, leases: 0 });
    expect(result.model.state.status).toBe("idle");
    expect(result.effects).toEqual(capEffects(capped));
  },
);

test("new preparation and reset clear every deferred ready flag", () => {
  const stale = { ...idle(), ringPinned: true, rotateDue: true, capDue: true };
  const preparing = run(stale, { type: "PREPARE" }).model;
  expect(preparing).toMatchObject({ ringPinned: false, rotateDue: false, capDue: false });
  const failed: AttemptModel = {
    ...stale,
    state: { status: "failed", instance: INSTANCE, attemptId: "prior-attempt", error: ERROR },
  };
  const reset = run(failed, { type: "RESET" }, { leases: 0 }).model;
  expect(reset).toMatchObject({ ringPinned: false, rotateDue: false, capDue: false });
});
