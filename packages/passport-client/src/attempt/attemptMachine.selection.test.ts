// @vitest-environment node
import { expect, test } from "vitest";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { PassportError } from "../errors/PassportError.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { createRingLink } from "../shared/RingLink.js";
import { attemptMachine } from "./attemptMachine.js";
import {
  createAttemptModel,
  type AttemptContext,
  type AttemptEvent,
  type AttemptModel,
} from "./attemptModel.js";

const D: PassportInstance = Object.freeze({
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
});
const D_CHOSEN: PassportInstance = Object.freeze({ ...D });
const C: PassportInstance = Object.freeze({
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
});
const W = Object.freeze({ name: "popup" }) as unknown as Window;
const LINK = createRingLink(() => "pubkyauth://" + "selection-private-canary");
const TIMEOUTS = resolveClientOptions({}, (value) => value).timeouts;
let sequence = 0;
const step = (model: AttemptModel, event: AttemptEvent, context: Partial<AttemptContext> = {}) =>
  attemptMachine(model, event, {
    defaultInstance: D,
    attemptId: `selection-${++sequence}`,
    now: 1000,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: TIMEOUTS,
    ...context,
  });
/** A Session's profile read settles at once with no profile; profile tests cover the rest. */
const run = (model: AttemptModel, event: AttemptEvent, context: Partial<AttemptContext> = {}) => {
  const first = step(model, event, context);
  const check = first.effects.find((effect) => effect.type === "CheckProfile");
  if (!check) return first;
  const read = step(first.model, { type: "PROFILE_MISSING", sessionId: check.sessionId }, context);
  return { model: read.model, effects: [...first.effects, ...read.effects] };
};
const select = (model: AttemptModel, instance: PassportInstance, leases = 0) =>
  run(model, { type: "SELECT_INSTANCE", instance }, { leases });
const session = (flowId: number): AttemptEvent => ({
  type: "SESSION_RECEIVED",
  flowId,
  sessionId: 40,
  publicKey: "approved-key",
  capabilities: [],
  capabilitiesMatch: true,
});
const ready = (instance: PassportInstance = C) => {
  const preparing = run(createAttemptModel(instance), { type: "PREPARE" }, { leases: 1 }).model;
  return run(
    preparing,
    { type: "FLOW_CREATED", flowId: preparing.flow!, ringLink: LINK },
    { leases: 1 },
  ).model;
};

test("another origin frees the prepared QR without a drain and prepares on the new selection", () => {
  const before = ready();
  const old = before.flow!;
  const result = select(before, D, 1);
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: old });
  expect(result.effects.map((effect) => effect.type)).not.toContain("RetireFlow");
  expect(result.effects).toContainEqual({
    type: "CreateFlow",
    flowId: result.model.flow,
    instance: D,
  });
  expect(result.model.flow).not.toBe(old);
  expect(result.model.selection).toBe(D);
  expect(result.model.state).toEqual({ status: "preparing", instance: D });
  expect(result.model.flows.get(old)).toMatchObject({ status: "freeing", endedBy: "app" });
  // A29: a late Session from the withdrawn QR can no longer sign in.
  const late = run(result.model, session(old));
  expect(late.model.state).toBe(result.model.state);
  expect(late.effects).toEqual([
    { type: "RevokeSession", sessionId: 40 },
    { type: "Diagnostic", code: "late_session_revoked" },
  ]);
});

test("rotated drains and flows still in creation end with the old selection", () => {
  const rotated = run(ready(), { type: "RING_ROTATE" }, { leases: 1 }).model;
  const [drain, creating] = [...rotated.flows.keys()];
  expect(rotated.flows.get(drain!)?.status).toBe("draining");
  expect(rotated.flows.get(creating!)?.status).toBe("creating");
  const result = select(rotated, D);
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: drain });
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: creating });
  expect(result.model.state).toEqual({ status: "idle", instance: D });
  expect(result.model.flow).toBeUndefined();
  expect(run(result.model, session(drain!)).effects).toContainEqual({
    type: "Diagnostic",
    code: "late_session_revoked",
  });
  expect(
    run(result.model, { type: "FLOW_CREATED", flowId: creating!, ringLink: LINK }).effects,
  ).toEqual([{ type: "FreeFlow", flowId: creating }]);
});

test("the same origin only updates selection metadata and keeps the prepared flow", () => {
  const before = ready(D);
  const result = select(before, D_CHOSEN, 1);
  expect(result.effects).toEqual([]);
  expect(result.model.flow).toBe(before.flow);
  expect(result.model.state).toMatchObject({ status: "ready", instance: D_CHOSEN });
  expect(result.model.selection).toBe(D_CHOSEN);
  expect(run(result.model, session(before.flow!)).model.state).toMatchObject({
    status: "signed-in",
  });
});

test("a failed attempt's drain ends and the view returns to idle on the new selection", () => {
  const opening = run(createAttemptModel(C), { type: "SIGN_IN", popup: W, instance: C }).model;
  const live = run(
    opening,
    { type: "FLOW_CREATED", flowId: opening.flow!, ringLink: LINK },
    { leases: 1 },
  ).model;
  const failed = run(live, { type: "ATTEMPT_TIMEOUT" }).model;
  const drain = opening.flow!;
  expect(failed.flows.get(drain)?.status).toBe("draining");
  const result = select(failed, D);
  expect(result.model.state).toEqual({ status: "idle", instance: D });
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: drain });
  expect(run(result.model, session(drain)).model.state).toEqual({ status: "idle", instance: D });
});

test("idle drops a last error from the old selection; signed-in keeps its attempt state", () => {
  const errored = {
    ...createAttemptModel(C),
    state: { status: "idle" as const, instance: C, lastError: new PassportError("network") },
  };
  expect(select(errored, D).model.state).toEqual({ status: "idle", instance: D });
  const opening = run(createAttemptModel(C), { type: "SIGN_IN", popup: W, instance: C }).model;
  const live = run(opening, {
    type: "FLOW_CREATED",
    flowId: opening.flow!,
    ringLink: LINK,
  }).model;
  const signedIn = run(live, session(opening.flow!)).model;
  expect(signedIn.state.status).toBe("signed-in");
  const result = select(signedIn, D, 1);
  expect(result.model.state).toBe(signedIn.state);
  expect(result.model.selection).toBe(D);
  expect(result.effects.map((effect) => effect.type)).not.toContain("CreateFlow");
  expect(run(result.model, { type: "RESET" }).model.state).toEqual({
    status: "idle",
    instance: D,
  });
});

test.each(["opening", "disposed"] as const)("%s ignores a selection change", (name) => {
  const opening = run(createAttemptModel(C), { type: "SIGN_IN", popup: W, instance: C }).model;
  const before = name === "opening" ? opening : run(opening, { type: "DISPOSE" }).model;
  expect(select(before, D, 1)).toEqual({ model: before, effects: [] });
});
