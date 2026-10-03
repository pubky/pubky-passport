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
const CUSTOM = Object.freeze({
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
});
const WINDOW = Object.freeze({ name: "popup" }) as unknown as Window;
const LINK = createRingLink(() => "pubkyauth://" + "session-private-canary");
const CAPABILITIES = Object.freeze(["/pub/example.app/:rw"]);
const CONTEXT: AttemptContext = {
  defaultInstance: INSTANCE,
  attemptId: "session-attempt-0123456",
  now: 1000,
  leases: 0,
  visible: true,
  profile: "optional",
  timeouts: resolveClientOptions({}, (value) => value).timeouts,
};
let attemptSequence = 0;
/** A Session's profile read settles at once with no profile; profile tests cover the rest. */
const run = (model: AttemptModel, event: AttemptEvent, context: Partial<AttemptContext> = {}) => {
  const full = { ...CONTEXT, attemptId: `session-attempt-${++attemptSequence}`, ...context };
  const first = attemptMachine(model, event, full);
  const check = first.effects.find((effect) => effect.type === "CheckProfile");
  if (!check || event.type !== "SESSION_RECEIVED") return first;
  const read = attemptMachine(
    first.model,
    { type: "PROFILE_MISSING", sessionId: check.sessionId },
    full,
  );
  return { model: read.model, effects: [...first.effects, ...read.effects] };
};
const idle = () => createAttemptModel(INSTANCE);
const types = (result: ReturnType<typeof run>) => result.effects.map((effect) => effect.type);
const popup = () => {
  const m = run(idle(), { type: "SIGN_IN", popup: WINDOW, instance: INSTANCE }).model;
  return run(m, { type: "FLOW_CREATED", flowId: m.flow!, ringLink: LINK }).model;
};
const ring = () => {
  const m = run(idle(), { type: "PREPARE" }, { leases: 1 }).model;
  return run(m, { type: "FLOW_CREATED", flowId: m.flow!, ringLink: LINK }).model;
};
const redirect = () => {
  const m = run(idle(), {
    type: "RETURN_DETECTED",
    valid: true,
    marker: "s",
    instance: CUSTOM,
    attemptId: "saved-session-attempt",
  }).model;
  return run(m, { type: "RESUMED", flowId: m.flow! }).model;
};
const session = (
  flowId: number,
  sessionId = 1,
  capabilitiesMatch = true,
): Extract<AttemptEvent, { type: "SESSION_RECEIVED" }> => ({
  type: "SESSION_RECEIVED",
  flowId,
  sessionId,
  publicKey: "approved-public-key",
  capabilities: CAPABILITIES,
  capabilitiesMatch,
});
/** What the app receives: the key and the profile, nothing about the route it came by. */
const info = () => ({ publicKey: "approved-public-key", profile: null });

test.each(["popup", "ring", "redirect"] as const)(
  "an SDK Session from %s is delivered once with its flow metadata",
  (via) => {
    const before = via === "popup" ? popup() : via === "ring" ? ring() : redirect();
    const result = run(before, session(before.flow!));
    expect(result.model.state).toMatchObject({
      status: "signed-in",
      publicKey: "approved-public-key",
      instance: via === "redirect" ? CUSTOM : INSTANCE,
    });
    expect(result.effects).toContainEqual({ type: "EmitSession", sessionId: 1, info: info() });
    expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
    expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(
      1, // A Session is held for its profile, so even a Ring sign-in ends that hold once.
    );
    expect(types(result)).not.toContain("RevokeSession");
    expect(result.model.flow).toBeUndefined();
    expect(JSON.stringify(result.model.state)).not.toContain("session-private-canary");
    expect(result.model.state).not.toHaveProperty("sessionId");
  },
);

test("a success outcome waits for its SDK Session and emits no authentication by itself", () => {
  const before = popup();
  const outcome = run(before, {
    type: "OUTCOME",
    outcome: "success",
    messageId: "one",
    version: 2,
  });
  expect(outcome.model.state.status).toBe("finishing");
  expect(types(outcome)).not.toContain("EmitSession");
  expect(run(outcome.model, session(before.flow!)).model.state.status).toBe("signed-in");
});

test.each([
  "timeout",
  "popup_closed",
  "request_rejected",
  "request_expired",
  "passport_error",
  "cancelled",
  "network",
] as const)(
  "a late Session after passive %s delivers through events without resolving signIn again",
  (code) => {
    const active = popup();
    const failed =
      code === "timeout"
        ? run(active, { type: "ATTEMPT_TIMEOUT" }).model
        : code === "popup_closed"
          ? run(
              run(run(active, { type: "READY", status: "valid" }).model, { type: "POPUP_CLOSED" })
                .model,
              { type: "CLOSED_GRACE" },
            ).model
          : code === "request_rejected" || code === "request_expired"
            ? run(active, {
                type: "READY",
                status: code === "request_rejected" ? "invalid" : "expired",
              }).model
            : code === "network"
              ? run(active, {
                  type: "POLL_FAILED",
                  flowId: active.flow!,
                  error: new PassportError("network"),
                }).model
              : run(active, {
                  type: "OUTCOME",
                  outcome: code === "cancelled" ? "cancel" : "error",
                  messageId: "failure",
                  version: 2,
                }).model;
    expect(failed.state).toMatchObject({ status: "failed", error: { code } });
    const event = session(active.flow!);
    const result = run(failed, event);
    expect(result.model.state.status).toBe("signed-in");
    expect(types(result)).toContain("EmitSession");
    expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
    expect(types(result)).not.toContain("RevokeSession");
  },
);

const APP_ENDINGS = [
  "cancel",
  "reset",
  "dispose",
  "abandoned",
  "use-default after failed",
] as const;
function endByApp(ending: (typeof APP_ENDINGS)[number]) {
  if (ending === "abandoned" || ending === "use-default after failed") {
    const active = customPopup(true);
    const before = run(
      active,
      ending === "abandoned" ? { type: "READY", status: "valid" } : { type: "ATTEMPT_TIMEOUT" },
    ).model;
    return { active, ended: run(before, { type: "USE_DEFAULT_INSTANCE", popup: WINDOW }).model };
  }
  const active = popup();
  const ended =
    ending === "reset"
      ? run(run(active, { type: "ATTEMPT_TIMEOUT" }).model, { type: "RESET" }).model
      : run(active, { type: ending === "cancel" ? "CANCEL" : "DISPOSE" }).model;
  return { active, ended };
}
test.each(APP_ENDINGS)(
  "a Session from a flow ended by %s is revoked without changing state",
  (ending) => {
    const { active, ended } = endByApp(ending);
    const result = run(ended, session(active.flow!));
    expect(result.model.state).toBe(ended.state);
    expect(result.effects).toContainEqual({ type: "RevokeSession", sessionId: 1 });
    expect(result.effects).toContainEqual({ type: "Diagnostic", code: "late_session_revoked" });
    expect(types(result)).not.toContain("EmitSession");
  },
);

test.each(["signed-in", "needs-profile", "held"] as const)(
  "a second Session during %s is revoked as a duplicate",
  (phase) => {
    const active = popup();
    const base = run(active, session(active.flow!)).model;
    const before: AttemptModel =
      phase === "signed-in"
        ? base
        : phase === "needs-profile"
          ? {
              ...active,
              state: {
                status: "needs-profile",
                instance: INSTANCE,
                attemptId: CONTEXT.attemptId,
                publicKey: "held-public-key",
                check: "missing",
              },
            }
          : {
              ...active,
              state: {
                status: "finishing",
                instance: INSTANCE,
                attemptId: CONTEXT.attemptId,
                via: "popup",
              },
              heldSession: { sessionId: 99, info: info() },
            };
    const result = run(before, session(active.flow!, 2));
    expect(result.model.state).toBe(before.state);
    expect(result.effects).toContainEqual({ type: "RevokeSession", sessionId: 2 });
    expect(result.effects).toContainEqual({
      type: "Diagnostic",
      code: "duplicate_session_revoked",
    });
    expect(types(result)).not.toContain("EmitSession");
  },
);

test("app-ended authority wins over duplicate and mismatched-capability checks", () => {
  const active = popup();
  const cancelled = run(active, { type: "CANCEL" }).model;
  const signedIn = run(active, session(active.flow!)).model.state;
  const result = run({ ...cancelled, state: signedIn }, session(active.flow!, 2, false));
  expect(result.effects).toContainEqual({ type: "Diagnostic", code: "late_session_revoked" });
  expect(result.effects).not.toContainEqual({
    type: "Diagnostic",
    code: "duplicate_session_revoked",
  });
  expect(result.effects).not.toContainEqual({ type: "Diagnostic", code: "capability_mismatch" });
  expect(result.model.state).toBe(signedIn);
});

test.each(["popup", "ring"] as const)(
  "mismatched capabilities from %s revoke and fail before delivery",
  (via) => {
    const before = via === "popup" ? popup() : ring();
    const result = run(before, session(before.flow!, 1, false));
    expect(result.model.state).toMatchObject({
      status: "failed",
      error: { code: "capability_mismatch" },
    });
    expect(result.effects).toContainEqual({ type: "RevokeSession", sessionId: 1 });
    expect(result.effects).toContainEqual({ type: "Diagnostic", code: "capability_mismatch" });
    expect(types(result)).not.toContain("EmitSession");
    expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(
      via === "popup" ? 1 : 0,
    );
    expect(result.model.flow).toBeUndefined();
  },
);

test("a matching draining Session still wins after another flow's capability mismatch", () => {
  const first = ring();
  const next = run(first, { type: "RING_ROTATE" }, { leases: 1 }).model;
  const ready = run(next, { type: "FLOW_CREATED", flowId: next.flow!, ringLink: LINK }).model;
  const failed = run(ready, session(ready.flow!, 1, false)).model;
  const result = run(failed, session(first.flow!, 2));
  expect(result.model.state.status).toBe("signed-in");
  expect(result.effects).toContainEqual({ type: "EmitSession", sessionId: 2, info: info() });
  expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
});

test("a delivered Session stops preparation even while a lease remains", () => {
  const before = ring();
  const result = run(before, session(before.flow!), { leases: 1 });
  expect(result.model.state.status).toBe("signed-in");
  expect(types(result)).not.toContain("CreateFlow");
  expect(run(result.model, { type: "PREPARE" }, { leases: 1 }).effects).toEqual([]);
});

test("an accepted exposed popup flow is freed once and cannot become a drain again", () => {
  const before = run(ring(), { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
  const result = run(before, session(before.flow!));
  expect(result.model.flows.get(before.flow!)?.status).toBe("freeing");
  expect(
    result.effects.filter((effect) => effect.type === "FreeFlow" && effect.flowId === before.flow),
  ).toHaveLength(1);
  expect(types(result)).not.toContain("RetireFlow");
});

test.each([false, true])(
  "an SDK Session can still arrive after request-ended (shownQR=%s)",
  (shownQr) => {
    const active = shownQr
      ? run(ring(), { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model
      : popup();
    const ended = run(active, { type: "READY", status: "completed" });
    expect(ended.model.state).toMatchObject({ status: "failed", error: { code: "request_ended" } });
    expect(types(ended)).not.toContain("EmitSession");
    const result = run(ended.model, session(active.flow!));
    expect(result.model.state).toMatchObject({
      status: "signed-in",
      publicKey: "approved-public-key",
    });
    expect(result.effects).toContainEqual({
      type: "EmitSession",
      sessionId: 1,
      info: info(),
    });
    expect(types(result)).not.toContain("RevokeSession");
    expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
  },
);

test("completed cannot replace a previously delivered SDK Session with an error", () => {
  const active = popup();
  const accepted = run(active, session(active.flow!));
  expect(types(accepted)).toContain("EmitSession");
  expect(run(accepted.model, { type: "READY", status: "completed" })).toEqual({
    model: accepted.model,
    effects: [],
  });
});

function preparedAfter(before: AttemptModel) {
  const preparing = run(before, { type: "PREPARE" }, { leases: 1 }).model;
  return run(
    preparing,
    { type: "FLOW_CREATED", flowId: preparing.flow!, ringLink: LINK },
    { leases: 1 },
  ).model;
}
function rotated(before: AttemptModel) {
  const next = run(before, { type: "RING_ROTATE" }, { leases: 1 }).model;
  return run(next, { type: "FLOW_CREATED", flowId: next.flow!, ringLink: LINK }, { leases: 1 })
    .model;
}
function customPopup(exposed: boolean) {
  const opening = run(createAttemptModel(CUSTOM), {
    type: "SIGN_IN",
    popup: WINDOW,
    instance: CUSTOM,
  }).model;
  return run(
    opening,
    { type: "FLOW_CREATED", flowId: opening.flow!, ringLink: LINK },
    { leases: exposed ? 1 : 0 },
  ).model;
}
function customRedirect() {
  const ready = preparedAfter(createAttemptModel(CUSTOM));
  return run(ready, {
    type: "SIGN_IN",
    instance: CUSTOM,
    route: { kind: "redirect", cause: "preferred" },
  }).model;
}
const unreadable = (flowId: number, sessionId = 500) => ({
  type: "SESSION_RECEIVED" as const,
  flowId,
  sessionId,
  error: new PassportError("internal"),
});

for (const source of ["successful companion", "rotated lease", "earlier failed attempt"] as const) {
  test.each([true, false])(
    `delivery supersedes ${source} even after a new start (matching=%s)`,
    (matches) => {
      let before = ring();
      let oldId = before.flow!;
      if (source === "successful companion") {
        before = run(before, {
          type: "SIGN_IN",
          instance: INSTANCE,
          route: { kind: "redirect", cause: "preferred" },
        }).model;
      } else if (source === "rotated lease") before = rotated(before);
      else {
        before = run(before, { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
        oldId = before.flow!;
        before = run(before, { type: "ATTEMPT_TIMEOUT" }).model;
        before = run(before, { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
      }
      const delivered = run(before, session(before.flow!)).model;
      expect(delivered.supersededThrough).toBe(before.lastFlowId);
      const restarted = run(delivered, {
        type: "SIGN_IN",
        instance: INSTANCE,
        popup: WINDOW,
      }).model;
      expect(restarted.flow).toBeGreaterThan(delivered.supersededThrough);
      const result = run(restarted, session(oldId, 2, matches));
      expect(result.model.state).toBe(restarted.state);
      expect(result.model.popup).toBe(WINDOW);
      expect(result.model.flow).toBe(restarted.flow);
      expect(result.effects).toContainEqual({
        type: "Diagnostic",
        code: "duplicate_session_revoked",
      });
      expect(result.effects).toContainEqual({ type: "RevokeSession", sessionId: 2 });
      for (const effect of ["EmitSession", "ClosePopup", "EndAttempt", "SetTimer", "RetireFlow"])
        expect(types(result)).not.toContain(effect);
    },
  );
}

test("without a prior delivery an older failed flow still wins during a retry", () => {
  const first = run(ring(), { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
  const failed = run(first, { type: "ATTEMPT_TIMEOUT" }).model;
  const retry = run(failed, { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
  expect(retry.supersededThrough).toBe(0);
  const result = run(retry, session(first.flow!));
  expect(result.model.state.status).toBe("signed-in");
  expect(types(result).filter((type) => type === "EmitSession")).toHaveLength(1);
  expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
  expect(result.model.supersededThrough).toBe(retry.lastFlowId);
});

test("reset takes precedence over the delivery watermark", () => {
  const first = ring();
  const signed = run(first, session(first.flow!)).model;
  const reset = run(signed, { type: "RESET" }).model;
  const result = run(reset, session(first.flow!, 2, false));
  expect(result.model.state).toBe(reset.state);
  expect(result.effects).toEqual([
    { type: "RevokeSession", sessionId: 2 },
    { type: "Diagnostic", code: "late_session_revoked" },
  ]);
});

for (const shape of ["retiring active", "freeing active", "redirect companion"] as const) {
  test(`default fallback after failed custom attempt abandons ${shape} before creating D`, () => {
    const active =
      shape === "redirect companion" ? customRedirect() : customPopup(shape === "retiring active");
    const failed =
      shape === "redirect companion"
        ? run(active, {
            type: "FLOW_FAILED",
            flowId: active.flow!,
            error: new PassportError("network"),
          }).model
        : run(active, { type: "ATTEMPT_TIMEOUT" }).model;
    const result = run(failed, { type: "USE_DEFAULT_INSTANCE", popup: WINDOW });
    expect(result.model.selection).toBe(CUSTOM);
    expect(result.model.state.instance).toBe(INSTANCE);
    const expectedFree = [...failed.flows]
      .filter(([, flow]) => flow.status === "draining")
      .map(([id]) => id);
    const freeEffects = result.effects.filter((effect) => effect.type === "FreeFlow");
    expect(freeEffects).toEqual(expectedFree.map((flowId) => ({ type: "FreeFlow", flowId })));
    const createIndex = types(result).indexOf("CreateFlow");
    for (const free of freeEffects) expect(result.effects.indexOf(free)).toBeLessThan(createIndex);
    expect(result.effects).toContainEqual({
      type: "CreateFlow",
      flowId: result.model.flow,
      instance: INSTANCE,
    });
    expect(types(result)).not.toContain("RetireFlow");
    for (const [id] of failed.flows) {
      expect(result.model.flows.get(id)?.endedBy).toBe("abandoned");
      const late = run(result.model, session(id, id + 50));
      expect(late.model.state).toBe(result.model.state);
      expect(late.effects).toEqual([
        { type: "RevokeSession", sessionId: id + 50 },
        { type: "Diagnostic", code: "late_session_revoked" },
      ]);
    }
  });
}

test("failed custom fallback leaves rotated lease and earlier attempt drains eligible", () => {
  const lease = preparedAfter(createAttemptModel(CUSTOM));
  const second = rotated(lease);
  const firstAttempt = run(second, { type: "SIGN_IN", instance: CUSTOM, popup: WINDOW }).model;
  const failedFirst = run(firstAttempt, { type: "ATTEMPT_TIMEOUT" }).model;
  const later = run(failedFirst, { type: "SIGN_IN", instance: CUSTOM, popup: WINDOW }).model;
  const failedLater = run(later, { type: "ATTEMPT_TIMEOUT" }).model;
  const fallback = run(failedLater, { type: "USE_DEFAULT_INSTANCE", popup: WINDOW }).model;
  for (const id of [lease.flow!, firstAttempt.flow!]) {
    expect(fallback.flows.get(id)?.endedBy).toBe("passive");
    expect(run(fallback, session(id)).model.state.status).toBe("signed-in");
  }
  expect(fallback.flows.get(later.flow!)?.endedBy).toBe("abandoned");
});

test("a custom retry retains I5 for its old drain and ends the new attempt exactly once", () => {
  const old = customPopup(true);
  const failed = run(old, { type: "ATTEMPT_TIMEOUT" }).model;
  const retry = run(failed, { type: "SIGN_IN", instance: CUSTOM, popup: WINDOW }).model;
  const result = run(retry, session(old.flow!));
  expect(result.model.state).toMatchObject({ status: "signed-in", instance: CUSTOM });
  expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
});

test("a first Session from a retired QR wins while its replacement is preparing", () => {
  const before = ring();
  const due = run(before, { type: "RING_ROTATE" }, { leases: 1, visible: false }).model;
  const replacement = run(due, { type: "DOCUMENT_VISIBLE" }, { leases: 1 }).model;
  const result = run(replacement, session(before.flow!), { leases: 1 });
  expect(result.model.state).toMatchObject({ status: "signed-in" });
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: replacement.flow });
  expect(
    run(result.model, { type: "FLOW_CREATED", flowId: replacement.flow!, ringLink: LINK }).effects,
  ).toEqual([{ type: "FreeFlow", flowId: replacement.flow }]);
});

test("a windowless adopted flow delivers via popup from detached unreachable", () => {
  const before = run(ring(), { type: "SIGN_IN", instance: INSTANCE, popup: undefined }).model;
  expect(before.state).toMatchObject({ status: "detached", reason: "unreachable" });
  const result = run(before, session(before.flow!));
  expect(result.model.state).toMatchObject({ status: "signed-in" });
  expect(result.effects).toContainEqual({ type: "EmitSession", sessionId: 1, info: info() });
});

const LIVE_OWNED: readonly [string, () => AttemptModel][] = [
  ["opening", () => run(ring(), { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model],
  ["waiting", () => run(popup(), { type: "READY", status: "valid" }).model],
  ["detached", () => run(popup(), { type: "POPUP_CLOSED" }).model],
  [
    "redirecting beside a ready code",
    () =>
      run(ring(), {
        type: "SIGN_IN",
        instance: INSTANCE,
        route: { kind: "redirect", cause: "preferred" },
      }).model,
  ],
  [
    "finishing popup",
    () =>
      run(popup(), { type: "OUTCOME", outcome: "success", version: 2, messageId: "finished" })
        .model,
  ],
  ["finishing redirect", redirect],
];

function profileHeld(needsProfile = false): AttemptModel {
  const active = popup();
  const before = run(active, session(active.flow!)).model;
  return {
    ...before,
    supersededThrough: 0,
    state: needsProfile
      ? {
          status: "needs-profile",
          instance: INSTANCE,
          attemptId: "held",
          publicKey: "approved-public-key",
          check: "missing",
        }
      : { status: "finishing", instance: INSTANCE, attemptId: "held", via: "popup" },
    heldSession: { sessionId: 499, info: info() },
  };
}
const ALL_OWNERSHIP_STATES: readonly [string, () => AttemptModel][] = [
  ["idle", idle],
  ["preparing", () => run(idle(), { type: "PREPARE" }, { leases: 1 }).model],
  ["ready", ring],
  ...LIVE_OWNED,
  ["failed", () => run(popup(), { type: "ATTEMPT_TIMEOUT" }).model],
  [
    "signed-in",
    () => {
      const before = popup();
      return run(before, session(before.flow!)).model;
    },
  ],
  ["needs-profile", () => profileHeld(true)],
  ["finishing with profile held", profileHeld],
  ["disposed", () => run(popup(), { type: "DISPOSE" }).model],
];

for (const [name, make] of ALL_OWNERSHIP_STATES) {
  for (const type of ["SESSION_RECEIVED"] as const) {
    test.each(["matching", "mismatched", "unreadable"] as const)(
      `${name}: unknown ${type} with %s metadata only revokes unattributed`,
      (metadata) => {
        const before = make();
        const unknownId = before.lastFlowId + 1;
        const event =
          metadata === "unreadable"
            ? unreadable(unknownId)
            : session(unknownId, 500, metadata === "matching");
        const result = run(before, { ...event, type });
        expect(result.model).toBe(before);
        expect(result.effects).toEqual([
          { type: "RevokeSession", sessionId: 500 },
          { type: "Diagnostic", code: "late_session_revoked", unattributed: true },
        ]);
      },
    );
  }
}

test("unknown-flow revocation leaves the real live flow free to deliver once", () => {
  const active = popup();
  const unknown = run(active, session(active.lastFlowId + 1));
  expect(unknown.model).toBe(active);
  const result = run(unknown.model, session(active.flow!, 2));
  expect(result.model.state.status).toBe("signed-in");
  expect(types(result).filter((type) => type === "EmitSession")).toHaveLength(1);
});

test.each(LIVE_OWNED)(
  "unreadable active Session in %s fails once and never retires its flow",
  (_name, make) => {
    const before = make();
    const event = unreadable(before.flow!);
    const result = run(before, event);
    expect(result.model.state).toMatchObject({ status: "failed", error: { code: "internal" } });
    expect(result.effects).toContainEqual({ type: "RevokeSession", sessionId: 500 });
    expect(result.effects.filter((effect) => effect.type === "FreeFlow")).toEqual([
      { type: "FreeFlow", flowId: before.flow },
    ]);
    expect(result.effects.filter((effect) => effect.type === "EndAttempt")).toEqual([
      { type: "EndAttempt", by: "passive", error: event.error },
    ]);
    // Only a ready code kept beside a same-tab redirect drains; the failed flow itself is freed.
    expect(result.effects).not.toContainEqual(
      expect.objectContaining({ type: "RetireFlow", flowId: before.flow }),
    );
    expect(types(result)).not.toContain("EmitSession");
    expect(result.model.flows.get(before.flow!)?.status).toBe("freeing");
  },
);

test("unreadable ready Session preserves its mapped error above a delayed replacement QR", () => {
  const before = ring();
  const error = new PassportError("internal", {
    messages: { "error.internal": "Local snapshot unavailable" },
  });
  const result = run(before, { ...unreadable(before.flow!), error }, { leases: 1 });
  expect(result.model.state).toEqual({ status: "idle", instance: INSTANCE, lastError: error });
  expect(result.effects).toEqual([
    { type: "RevokeSession", sessionId: 500 },
    { type: "FreeFlow", flowId: before.flow },
    { type: "SetTimer", timer: "PREPARE_RETRY", ms: 5000 },
  ]);
  expect(run(result.model, { type: "PREPARE_RETRY" }, { leases: 1 }).model.state).toMatchObject({
    status: "preparing",
    lastError: error,
  });
});

test("unreadable drain preserves a failed attempt's earlier error and another first Session can win", () => {
  const first = ring();
  const active = run(rotated(first), { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
  const failed = run(active, { type: "ATTEMPT_TIMEOUT" }).model;
  const result = run(failed, unreadable(active.flow!));
  expect(result.model.state).toBe(failed.state);
  expect(result.effects).toEqual([
    { type: "RevokeSession", sessionId: 500 },
    { type: "FreeFlow", flowId: active.flow },
  ]);
  expect(run(result.model, session(first.flow!)).model.state).toMatchObject({
    status: "signed-in",
  });
});

test("unreadable Session from an already freed popup cannot replace popup_closed", () => {
  const active = popup();
  const confirmed = run(active, { type: "READY", status: "valid" }).model;
  const closed = run(confirmed, { type: "POPUP_CLOSED" }).model;
  const failed = run(closed, { type: "CLOSED_GRACE" }).model;
  expect(failed.flows.get(active.flow!)?.status).toBe("freeing");
  const result = run(failed, unreadable(active.flow!));
  expect(result.model.state).toBe(failed.state);
  expect(result.effects).toEqual([{ type: "RevokeSession", sessionId: 500 }]);
});

test.each(["ready", "live"] as const)(
  "unreadable rotated QR preserves the newer %s flow",
  (state) => {
    const old = ring();
    let before = rotated(old);
    if (state === "live")
      before = run(before, { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
    const result = run(before, unreadable(old.flow!));
    expect(result.model.state).toBe(before.state);
    expect(result.model.flow).toBe(before.flow);
    expect(result.model.flows.get(before.flow!)).toBe(before.flows.get(before.flow!));
    expect(result.effects).toEqual([
      { type: "RevokeSession", sessionId: 500 },
      { type: "FreeFlow", flowId: old.flow },
    ]);
  },
);

test("unreadable redirect companion leaves the callback flow active", () => {
  const before = customRedirect();
  const result = run(before, unreadable(before.redirectQr!));
  expect(result.model.state).toBe(before.state);
  expect(result.model.flow).toBe(before.flow);
  expect(result.model.redirectQr).toBeUndefined();
  expect(result.effects).toEqual([
    { type: "RevokeSession", sessionId: 500 },
    { type: "FreeFlow", flowId: before.redirectQr },
  ]);
});

test.each([
  "signed-in",
  "needs-profile",
  "finishing-profile",
  "superseded",
  "app-ended",
  "abandoned",
] as const)("unreadable metadata cannot override the %s rule", (rule) => {
  const active = popup();
  let before = active;
  if (rule === "signed-in" || rule === "superseded") {
    before = run(active, session(active.flow!)).model;
    if (rule === "superseded")
      before = run(before, { type: "SIGN_IN", instance: INSTANCE, popup: WINDOW }).model;
  } else if (rule === "app-ended") before = run(active, { type: "CANCEL" }).model;
  else if (rule === "abandoned") {
    before = {
      ...active,
      flows: new Map(active.flows).set(active.flow!, {
        ...active.flows.get(active.flow!)!,
        endedBy: "abandoned",
      }),
    };
  } else before = profileHeld(rule === "needs-profile");
  const result = run(before, unreadable(active.flow!));
  expect(result.model.state).toBe(before.state);
  expect(result.effects).toContainEqual({
    type: "Diagnostic",
    code:
      rule === "app-ended" || rule === "abandoned"
        ? "late_session_revoked"
        : "duplicate_session_revoked",
  });
  expect(types(result)).not.toContain("EndAttempt");
  expect(types(result)).not.toContain("EmitSession");
});

test("an unreadable Session during preparation cannot revive the released flow on creation", () => {
  const before = run(idle(), { type: "PREPARE" }, { leases: 1 }).model;
  const result = run(before, unreadable(before.flow!));
  expect(result.model.state).toBe(before.state);
  expect(result.model.flow).toBeUndefined();
  expect(result.effects).toEqual([
    { type: "RevokeSession", sessionId: 500 },
    { type: "FreeFlow", flowId: before.flow },
  ]);
  expect(
    run(result.model, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK }).effects,
  ).toEqual([{ type: "FreeFlow", flowId: before.flow }]);
});
