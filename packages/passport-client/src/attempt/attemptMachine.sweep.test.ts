// @vitest-environment node
import { expect, test } from "vitest";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { PassportError } from "../errors/PassportError.js";
import { createRingLink } from "../shared/RingLink.js";
import { attemptMachine } from "./attemptMachine.js";
import {
  createAttemptModel,
  isLiveState,
  type AttemptContext,
  type AttemptEvent,
  type AttemptModel,
} from "./attemptModel.js";

const INSTANCE = Object.freeze({
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
});
const OTHER = Object.freeze({
  origin: "https://other.example",
  host: "other.example",
  isCustom: true,
});
const W = Object.freeze({ name: "owned-window" }) as unknown as Window;
const LINK = createRingLink(() => "pubkyauth://" + "sweep-private-canary");
const ERROR = new PassportError("network");
const CONTEXT: AttemptContext = {
  defaultInstance: INSTANCE,
  attemptId: "sweep-attempt-012345678",
  now: 1000,
  leases: 0,
  visible: true,
  profile: "optional",
  timeouts: resolveClientOptions({}, (value) => value).timeouts,
};
let attemptSequence = 0;
const run = (model: AttemptModel, event: AttemptEvent, context: Partial<AttemptContext> = {}) =>
  attemptMachine(model, event, { ...CONTEXT, attemptId: `sweep-${++attemptSequence}`, ...context });
const idle = createAttemptModel(INSTANCE);
const preparing = run(idle, { type: "PREPARE" }, { leases: 1 }).model;
const ready = run(preparing, {
  type: "FLOW_CREATED",
  flowId: preparing.flow!,
  ringLink: LINK,
}).model;
const opening = run(idle, { type: "SIGN_IN", popup: W, instance: INSTANCE }).model;
const opened = run(opening, { type: "FLOW_CREATED", flowId: opening.flow!, ringLink: LINK }).model;
const waiting = run(opened, { type: "READY", status: "valid" }).model;
const redirecting = run(ready, {
  type: "SIGN_IN",
  instance: INSTANCE,
  route: { kind: "redirect", cause: "blocked" },
}).model;
const saved = run(redirecting, {
  type: "FLOW_CREATED",
  flowId: redirecting.flow!,
  ringLink: LINK,
}).model;
const returning = run(idle, {
  type: "RETURN_DETECTED",
  valid: true,
  marker: "s",
  instance: INSTANCE,
  attemptId: "saved-attempt",
}).model;
const session = (
  flowId: number,
  capabilitiesMatch = true,
  type: "SESSION_RECEIVED" = "SESSION_RECEIVED",
  sessionId = 123,
): AttemptEvent => ({
  type,
  flowId,
  sessionId,
  publicKey: "approved-key",
  capabilities: [],
  capabilitiesMatch,
});

const models: [string, AttemptModel, number?][] = [
  ["idle/empty", idle],
  ["idle/draining", run(ready, { type: "LEASE_IDLE" }).model],
  ["preparing", preparing],
  ["ready", ready],
  ["ready/pinned", run(ready, { type: "RING_OPENED" }).model],
  ["opening/creating", opening],
  ["opening/live", opened],
  ["waiting/confirmed", waiting],
  ["waiting/unconfirmed", run(opened, { type: "HANDSHAKE_HINT" }).model],
  ["waiting/closed", run(waiting, { type: "POPUP_CLOSED" }).model],
  ["detached/unreachable", run(opened, { type: "POPUP_CLOSED" }).model],
  ["detached/request-lost", run(waiting, { type: "READY", status: "empty" }).model],
  ["redirecting/creating", redirecting],
  ["redirecting/saved", saved],
  [
    "finishing/popup",
    run(opened, { type: "OUTCOME", outcome: "success", messageId: "first", version: 2 }).model,
  ],
  ["finishing/resuming", returning],
  ["finishing/redirect", run(returning, { type: "RESUMED", flowId: returning.flow! }).model],
  ["finishing/restored", run(saved, { type: "PAGE_RESTORED" }).model],
  ["failed", run(opened, { type: "ATTEMPT_TIMEOUT" }).model],
  ["signed-in", run(opened, session(opened.flow!, true, "SESSION_RECEIVED", 99)).model],
  ["disposed", run(opened, { type: "DISPOSE" }).model],
];

const pinned = run(ready, { type: "RING_OPENED" }).model;
const windowless = run(idle, { type: "SIGN_IN", popup: undefined, instance: INSTANCE }).model;
models.push(
  ["ready/rotate-due", run(ready, { type: "RING_ROTATE" }, { visible: false }).model],
  ["ready/rotate-due+pinned", run(pinned, { type: "RING_ROTATE" }, { visible: false }).model],
  ["ready/cap-due+pinned", run(pinned, { type: "HIDDEN_CAP" }, { visible: false }).model],
  ["opening/windowless", windowless],
  [
    "detached/windowless",
    run(windowless, { type: "FLOW_CREATED", flowId: windowless.flow!, ringLink: LINK }).model,
  ],
  ["redirecting/companion", redirecting, redirecting.redirectQr!],
);
const profileHeld = run(opened, session(opened.flow!, true, "SESSION_RECEIVED", 900), {
  profile: "required",
}).model;
const profileMissing = run(profileHeld, { type: "PROFILE_MISSING", sessionId: 900 }).model;
const profileRestarted = run(run(opened, { type: "ATTEMPT_TIMEOUT" }).model, {
  type: "SIGN_IN",
  instance: INSTANCE,
  popup: W,
}).model;
const profileNewActive = run(profileRestarted, {
  type: "FLOW_CREATED",
  flowId: profileRestarted.flow!,
  ringLink: LINK,
}).model;
const profileOldWinner = run(
  profileNewActive,
  session(opened.flow!, true, "SESSION_RECEIVED", 900),
  {
    profile: "required",
  },
).model;
models.push(
  ["finishing/profile", profileHeld],
  ["needs-profile/missing", profileMissing],
  ["needs-profile/error", run(profileHeld, { type: "PROFILE_CHECK_FAILED", sessionId: 900 }).model],
  ["needs-profile/checking", run(profileMissing, { type: "FOCUS" }).model],
  ["finishing/profile/older-winner", profileOldWinner],
  [
    "needs-profile/older-winner",
    run(profileOldWinner, { type: "PROFILE_MISSING", sessionId: 900 }).model,
  ],
);
// These paired histories vary the watermark without marking a newer active flow
// as superseded, which no real transition can do.
for (const deliveredFirst of [false, true]) {
  const first = run(
    opening,
    { type: "FLOW_CREATED", flowId: opening.flow!, ringLink: LINK },
    { leases: 1 },
  ).model;
  const ended = run(
    first,
    deliveredFirst ? session(first.flow!) : { type: "ATTEMPT_TIMEOUT" },
  ).model;
  const restarted = run(ended, { type: "SIGN_IN", popup: W, instance: INSTANCE }).model;
  const created = run(restarted, {
    type: "FLOW_CREATED",
    flowId: restarted.flow!,
    ringLink: LINK,
  }).model;
  models.push(
    [`opening/old-flow/watermark-${deliveredFirst ? "delivered" : "none"}`, restarted, first.flow!],
    [
      `waiting/old-flow/watermark-${deliveredFirst ? "delivered" : "none"}`,
      run(created, { type: "READY", status: "valid" }).model,
      first.flow!,
    ],
  );
}
const custom = {
  ...INSTANCE,
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
};
const customStart = run(createAttemptModel(custom), {
  type: "SIGN_IN",
  popup: W,
  instance: custom,
}).model;
const customLive = run(
  customStart,
  { type: "FLOW_CREATED", flowId: customStart.flow!, ringLink: LINK },
  { leases: 1 },
).model;
const customFailed = run(customLive, { type: "ATTEMPT_TIMEOUT" }).model;
models.push(
  ["failed/custom-drain", customFailed],
  [
    "opening/default-with-abandoned-custom",
    run(customFailed, { type: "USE_DEFAULT_INSTANCE", popup: W }).model,
    customLive.flow!,
  ],
);

function sessionEvents(flowId: number): AttemptEvent[] {
  return (["SESSION_RECEIVED"] as const).flatMap((type) => [
    session(flowId, true, type),
    session(flowId, false, type),
    { type, flowId, sessionId: 123, error: new PassportError("internal") },
  ]);
}
const PROFILE_WINDOW = Object.freeze({ name: "profile-window" }) as unknown as Window;
function events(flowId: number): AttemptEvent[] {
  return [
    ...sessionEvents(flowId),
    ...[900, 901].map((sessionId) => ({
      type: "PROFILE_FOUND" as const,
      sessionId,
      profile: { name: "Sweep" },
    })),
    ...(["PROFILE_MISSING", "PROFILE_CHECK_FAILED"] as const).flatMap((type) =>
      [900, 901].map((sessionId) => ({ type, sessionId })),
    ),
    { type: "PROFILE_READY" },
    { type: "PROFILE_WINDOW", popup: PROFILE_WINDOW },
    { type: "SELECT_INSTANCE", instance: { ...INSTANCE } },
    { type: "SELECT_INSTANCE", instance: OTHER },
    { type: "SIGN_IN", popup: undefined, instance: INSTANCE },
    { type: "SIGN_IN", popup: W, instance: INSTANCE },
    { type: "SIGN_IN", instance: INSTANCE, route: { kind: "redirect", cause: "preferred" } },
    { type: "SIGN_IN", instance: INSTANCE, route: { kind: "redirect", cause: "blocked" } },
    {
      type: "SIGN_IN",
      instance: INSTANCE,
      route: { kind: "failed", code: "popup_blocked", diagnostic: "redirect_unavailable" },
    },
    {
      type: "SIGN_IN",
      instance: INSTANCE,
      route: { kind: "failed", code: "unsupported_environment" },
    },
    { type: "FLOW_CREATED", flowId, ringLink: LINK },
    { type: "FLOW_FAILED", flowId, error: ERROR },
    { type: "POLL_FAILED", flowId, error: ERROR },
    { type: "RUNTIME_FAILED", flowId, error: ERROR },
    ...(["valid", "invalid", "empty", "expired", "completed"] as const).map((status) => ({
      type: "READY" as const,
      status,
    })),
    { type: "REOPEN", popup: W },
    { type: "USE_DEFAULT_INSTANCE", popup: W },
    { type: "STATUS", phase: "ring" },
    { type: "STATUS", phase: "granting" },
    ...(["success", "cancel", "error"] as const).map((outcome) => ({
      type: "OUTCOME" as const,
      outcome,
      messageId: "one",
      version: 2 as const,
    })),
    { type: "PAGE_HIDE", persisted: true },
    { type: "PAGE_HIDE", persisted: false },
    { type: "REDIRECT_SAVE_FAILED" },
    { type: "RETURN_DETECTED", valid: false },
    {
      type: "RETURN_DETECTED",
      valid: true,
      marker: "c",
      instance: INSTANCE,
      attemptId: "saved-return",
    },
    { type: "RESUMED", flowId },
    { type: "RESUME_FAILED", flowId },
    ...(
      [
        "HANDSHAKE_HINT",
        "POPUP_CLOSED",
        "CLOSED_GRACE",
        "DETACHED_TIMEOUT",
        "FINISHING_TIMEOUT",
        "ATTEMPT_TIMEOUT",
        "FOCUS",
        "PROFILE_RECHECK",
        "CANCEL",
        "RESET",
        "DISPOSE",
        "PREPARE",
        "PREPARE_RETRY",
        "RING_ROTATE",
        "RING_OPENED",
        "RING_RELOAD",
        "RING_PIN_ELAPSED",
        "HIDDEN_CAP",
        "LEASE_IDLE",
        "DOCUMENT_VISIBLE",
        "DOCUMENT_HIDDEN",
        "PAGE_RESTORED",
      ] as const
    ).map((type) => ({ type })),
  ];
}

const live = ["opening", "waiting", "detached", "redirecting", "finishing", "needs-profile"];
const allowed: Partial<Record<AttemptEvent["type"], readonly string[]>> = {
  SIGN_IN: ["idle", "failed", "signed-in", "preparing", "ready"],
  SELECT_INSTANCE: ["idle", "failed", "signed-in", "preparing", "ready"],
  FLOW_FAILED: ["opening", "preparing", "redirecting"],
  POLL_FAILED: [...live, "ready"],
  READY: ["opening", "waiting"],
  REOPEN: ["waiting", "detached"],
  USE_DEFAULT_INSTANCE: ["waiting", "detached", "failed"],
  STATUS: ["waiting"],
  OUTCOME: ["opening", "waiting", "detached", "finishing", "failed", "signed-in"],
  PAGE_HIDE: ["opening", "waiting", "detached", "finishing", "needs-profile"],
  HANDSHAKE_HINT: ["opening"],
  POPUP_CLOSED: ["opening", "waiting", "finishing", "needs-profile"],
  PROFILE_READY: ["finishing", "needs-profile"],
  PROFILE_WINDOW: ["needs-profile"],
  CLOSED_GRACE: ["waiting"],
  DETACHED_TIMEOUT: ["detached"],
  FINISHING_TIMEOUT: ["finishing"],
  ATTEMPT_TIMEOUT: live,
  RUNTIME_FAILED: [...live, "preparing", "ready"],
  FOCUS: ["waiting", "needs-profile"],
  PROFILE_RECHECK: ["needs-profile"],
  PROFILE_FOUND: ["finishing", "needs-profile"],
  PROFILE_MISSING: ["finishing", "needs-profile"],
  PROFILE_CHECK_FAILED: ["finishing", "needs-profile"],
  CANCEL: [...live, "preparing", "ready"],
  RESET: ["signed-in", "failed", "idle"],
  DISPOSE: ["idle", "failed", "signed-in", "preparing", "ready", ...live],
  RING_ROTATE: ["ready"],
  RING_OPENED: ["ready"],
  RING_RELOAD: ["ready", "idle", "failed"],
  RING_PIN_ELAPSED: ["ready"],
  HIDDEN_CAP: ["ready"],
  LEASE_IDLE: ["preparing", "ready"],
  DOCUMENT_VISIBLE: ["ready", "idle", "needs-profile"],
  DOCUMENT_HIDDEN: ["ready"],
  PAGE_RESTORED: ["redirecting"],
  REDIRECT_SAVE_FAILED: ["redirecting"],
  RETURN_DETECTED: ["idle"],
  RESUME_FAILED: ["finishing"],
};

const visibilityEvents = new Set<AttemptEvent["type"]>([
  "RING_ROTATE",
  "RING_PIN_ELAPSED",
  "HIDDEN_CAP",
  "DOCUMENT_VISIBLE",
  "DOCUMENT_HIDDEN",
]);
for (const [name, before, targetFlow] of models) {
  const flowId = targetFlow ?? before.flow ?? [...before.flows.keys()][0] ?? before.lastFlowId + 1;
  const allEvents = [...events(flowId), ...sessionEvents(before.lastFlowId + 1)];
  for (const [index, event] of allEvents.entries()) {
    for (const profile of ["required", "optional"] as const) {
      for (const visible of [true, false]) {
        for (const leases of visibilityEvents.has(event.type) ? [0, 1] : [0]) {
          test(`${name} × ${event.type} (${index}, visible=${visible}, leases=${leases}, profile=${profile}) preserves the applicable invariants`, () => {
            const originalState = before.state;
            const originalFlows = [...before.flows.entries()];
            const result = run(before, event, { visible, leases, profile });
            const after = result.model;
            const effectTypes = result.effects.map((effect) => effect.type);
            const isSession = event.type === "SESSION_RECEIVED";
            expect(before.state).toBe(originalState);
            expect([...before.flows.entries()]).toEqual(originalFlows);
            expect(JSON.stringify(result)).not.toContain("sweep-private-canary");
            if (before.state.status !== "signed-in" && after.state.status === "signed-in")
              expect(
                (event.type === "PROFILE_FOUND" ||
                  (profile === "optional" &&
                    (event.type === "PROFILE_MISSING" || event.type === "PROFILE_CHECK_FAILED"))) &&
                  before.profileChecking &&
                  event.sessionId === before.heldSession?.sessionId,
              ).toBe(true);
            if (
              isLiveState(before.state) &&
              ["signed-in", "failed", "idle"].includes(after.state.status)
            )
              expect(effectTypes.filter((type) => type === "EndAttempt")).toHaveLength(1);
            expect(effectTypes.some((type) => /openwindow/iu.test(type))).toBe(false);
            if (after.flow !== undefined) {
              expect(after.flows.has(after.flow)).toBe(true);
              expect(["creating", "created", "polling"]).toContain(
                after.flows.get(after.flow)?.status,
              );
            }
            for (const effect of result.effects) {
              if (effect.type === "StartPolling")
                expect(before.flows.get(effect.flowId)?.status).not.toBe("polling");
              if (effect.type === "StartHandshake")
                expect(effect.origin).toBe(after.state.instance.origin);
              if (effect.type === "EmitSession")
                expect(after.supersededThrough).toBe(after.lastFlowId);
            }
            if (isSession) {
              const flow = before.flows.get(event.flowId);
              if (!flow) {
                expect(after).toBe(before);
                expect(result.effects).toEqual([
                  { type: "RevokeSession", sessionId: event.sessionId },
                  { type: "Diagnostic", code: "late_session_revoked", unattributed: true },
                ]);
              } else if (flow.endedBy === "app" || flow.endedBy === "abandoned") {
                expect(after.state).toBe(before.state);
                expect(result.effects).toContainEqual({
                  type: "Diagnostic",
                  code: "late_session_revoked",
                });
                expect(effectTypes).toContain("RevokeSession");
                expect(effectTypes).not.toContain("EmitSession");
              } else if (
                before.state.status === "signed-in" ||
                before.state.status === "needs-profile" ||
                before.heldSession !== undefined ||
                event.flowId <= before.supersededThrough
              ) {
                expect(after.state).toBe(before.state);
                expect(result.effects).toContainEqual({
                  type: "Diagnostic",
                  code: "duplicate_session_revoked",
                });
                expect(effectTypes).toContain("RevokeSession");
                for (const type of [
                  "EmitSession",
                  "EndAttempt",
                  "ClosePopup",
                  "RetireFlow",
                  "SetTimer",
                ])
                  expect(effectTypes).not.toContain(type);
              } else if ("error" in event) {
                expect(effectTypes).toContain("RevokeSession");
                expect(effectTypes).not.toContain("EmitSession");
                expect(
                  result.effects.some(
                    (effect) => effect.type === "RetireFlow" && effect.flowId === event.flowId,
                  ),
                ).toBe(false);
                if (before.flow === event.flowId && isLiveState(before.state)) {
                  expect(after.state).toMatchObject({ status: "failed", error: event.error });
                  expect(effectTypes.filter((type) => type === "EndAttempt")).toHaveLength(1);
                } else if (before.flow === event.flowId && before.state.status === "ready") {
                  expect(after.state).toMatchObject({ status: "idle", lastError: event.error });
                  expect(result.effects).toContainEqual({
                    type: "SetTimer",
                    timer: "PREPARE_RETRY",
                    ms: 5000,
                  });
                } else expect(after.state).toBe(before.state);
              } else if (!event.capabilitiesMatch) {
                expect(after.state).toMatchObject({
                  status: "failed",
                  error: { code: "capability_mismatch" },
                });
                expect(effectTypes).toContain("RevokeSession");
                expect(effectTypes).not.toContain("EmitSession");
              } else {
                // Both profile modes hold the Session until its profile is read.
                expect(after.state.status).toBe("finishing");
                expect(after.heldSession?.sessionId).toBe(event.sessionId);
                expect(effectTypes).toContain("CheckProfile");
                expect(effectTypes).not.toContain("EmitSession");
                expect(effectTypes).not.toContain("RevokeSession");
                expect(after.supersededThrough).toBe(before.supersededThrough);
              }
            }
            if (before.heldSession && !after.heldSession) {
              const heldRevoke = result.effects.filter(
                (effect) =>
                  effect.type === "RevokeSession" &&
                  effect.sessionId === before.heldSession!.sessionId,
              );
              expect(heldRevoke).toHaveLength(after.state.status === "signed-in" ? 0 : 1);
            }
            const lifecycleException =
              isSession ||
              event.type === "FLOW_CREATED" ||
              event.type === "RESUMED" ||
              (event.type === "READY" &&
                event.status === "completed" &&
                before.state.status === "detached") ||
              (event.type === "POLL_FAILED" &&
                before.flows.get(event.flowId)?.status === "draining");
            if (
              !lifecycleException &&
              (before.disposed || !allowed[event.type]?.includes(before.state.status))
            )
              expect(result).toEqual({ model: before, effects: [] });
            if (
              event.type === "OUTCOME" &&
              ["finishing", "failed", "signed-in"].includes(before.state.status)
            ) {
              expect(after.state).toBe(before.state);
              expect(effectTypes).toEqual(["Ack"]);
            }
            if (
              isLiveState(before.state) &&
              isLiveState(after.state) &&
              event.type !== "USE_DEFAULT_INSTANCE"
            )
              expect(after.state.instance).toBe(before.state.instance);
            for (const [id, flow] of before.flows) {
              expect(after.flows.get(id)?.instance).toBe(flow.instance);
            }
            if (
              event.type === "SELECT_INSTANCE" &&
              !before.disposed &&
              !isLiveState(before.state)
            ) {
              expect(after.selection).toBe(event.instance);
              if (event.instance.origin !== before.selection.origin) {
                // A29: no earlier flow keeps any authority on the old selection.
                for (const flow of after.flows.values())
                  if (flow.instance.origin !== event.instance.origin)
                    expect(flow).toMatchObject({ status: "freeing", endedBy: "app" });
                expect(effectTypes).not.toContain("RetireFlow");
                if (before.state.status === "signed-in") expect(after.state).toBe(before.state);
                else expect(after.state.instance).toBe(event.instance);
              } else expect(effectTypes).toEqual([]);
            }
            const retired = result.effects.filter((effect) => effect.type === "RetireFlow");
            const created = result.effects.filter((effect) => effect.type === "CreateFlow");
            if (event.type === "DOCUMENT_HIDDEN" || (event.type === "RING_ROTATE" && !visible)) {
              for (const type of ["FreeFlow", "RetireFlow", "CreateFlow"])
                expect(effectTypes).not.toContain(type);
            }
            if (event.type === "DOCUMENT_VISIBLE") {
              expect(effectTypes).not.toContain("FreeFlow");
              if (before.state.status === "ready") expect(after.state.status).not.toBe("idle");
              if (retired.length) {
                expect(visible).toBe(true);
                expect(before.state.status).toBe("ready");
                expect(before.rotateDue).toBe(true);
                expect(before.ringPinned).toBe(false);
                expect(retired).toEqual([
                  { type: "RetireFlow", flowId: before.flow, ms: CONTEXT.timeouts.ringGraceMs },
                ]);
                expect(created).toHaveLength(1);
              }
            }
            if (event.type === "RING_PIN_ELAPSED" && !visible && retired.length)
              expect(leases === 0 || before.capDue).toBe(true);
          });
        }
      }
    }
  }
}
