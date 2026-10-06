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
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
});
const DEFAULT = Object.freeze({
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
});
const W = {} as Window;
const LINK = createRingLink(() => "pubkyauth://profile-test-private-canary");
const CTX: AttemptContext = {
  defaultInstance: DEFAULT,
  attemptId: "profile-attempt",
  now: 1000,
  leases: 0,
  visible: true,
  profile: "required",
  timeouts: resolveClientOptions({}, (v) => v).timeouts,
};
const run = (m: AttemptModel, e: AttemptEvent, context: Partial<AttemptContext> = {}) =>
  attemptMachine(m, e, { ...CTX, ...context });
const session = (flowId: number, sessionId = 1): AttemptEvent => ({
  type: "SESSION_RECEIVED",
  flowId,
  sessionId,
  publicKey: "approved-key",
  capabilities: [],
  capabilitiesMatch: true,
});
const checks = (
  model: AttemptModel,
  type: "PROFILE_FOUND" | "PROFILE_MISSING" | "PROFILE_CHECK_FAILED",
  sessionId = 1,
) =>
  run(
    model,
    type === "PROFILE_FOUND"
      ? { type, sessionId, profile: { name: "Approved" } }
      : { type, sessionId },
  );
function opened() {
  const opening = run(createAttemptModel(INSTANCE), {
    type: "SIGN_IN",
    instance: INSTANCE,
    popup: W,
  }).model;
  return run(opening, { type: "FLOW_CREATED", flowId: opening.flow!, ringLink: LINK }).model;
}
function held() {
  const m = opened();
  return run(m, session(m.flow!)).model;
}
function missing() {
  return checks(held(), "PROFILE_MISSING").model;
}

test("a valid Session is held privately until the matching profile read succeeds", () => {
  const m = opened();
  const held = run(m, session(m.flow!));
  expect(held.model.state).toMatchObject({ status: "finishing", via: "popup", instance: INSTANCE });
  expect(held.model.heldSession).toMatchObject({
    sessionId: 1,
    info: { publicKey: "approved-key" },
  });
  expect(held.effects).toContainEqual({
    type: "CheckProfile",
    sessionId: 1,
    publicKey: "approved-key",
  });
  // The window stays open until the profile is known.
  expect(held.effects).not.toContainEqual({ type: "ClosePopup", popup: W });
  expect(held.model.popup).toBe(W);
  expect(held.effects).toContainEqual({ type: "StopHandshake" });
  expect(held.effects).toContainEqual({ type: "StopHeartbeat" });
  expect(held.effects).toContainEqual({
    type: "ClearTimer",
    timers: expect.arrayContaining(["FINISHING", "CLOSED_GRACE", "DETACHED"]),
  });
  expect(held.effects.some((e) => e.type === "EmitSession" || e.type === "EndAttempt")).toBe(false);
  const found = checks(held.model, "PROFILE_FOUND");
  expect(found.model.state).toMatchObject({
    status: "signed-in",
    instance: INSTANCE,
  });
  expect(found.model.heldSession).toBeUndefined();
  expect(found.model.supersededThrough).toBe(found.model.lastFlowId);
  expect(found.effects.filter((e) => e.type === "EmitSession")).toEqual([
    {
      type: "EmitSession",
      sessionId: 1,
      info: {
        ...held.model.heldSession!.info,
        profile: { name: "Approved" },
        instance: INSTANCE.origin,
      },
    },
  ]);
  expect(found.effects.filter((e) => e.type === "EndAttempt")).toHaveLength(1);
  expect(found.effects.some((e) => e.type === "RevokeSession")).toBe(false);
});

test.each(["PROFILE_MISSING", "PROFILE_CHECK_FAILED"] as const)(
  "%s enters the retry view with one new profile deadline",
  (type) => {
    const result = checks(held(), type);
    expect(result.model.state).toMatchObject({
      status: "needs-profile",
      check: type === "PROFILE_MISSING" ? "missing" : "error",
      publicKey: "approved-key",
    });
    expect(result.effects).toContainEqual({
      type: "SetTimer",
      timer: "ATTEMPT",
      ms: CTX.timeouts.attemptMs,
    });
    expect(result.effects).toContainEqual({ type: "SetTimer", timer: "PROFILE_RECHECK", ms: 5000 });
    expect(result.effects.filter((e) => e.type === "Diagnostic")).toEqual(
      type === "PROFILE_CHECK_FAILED" ? [{ type: "Diagnostic", code: "profile_check_failed" }] : [],
    );
    expect(
      result.effects.some(
        (e) => e.type === "EmitSession" || e.type === "RevokeSession" || e.type === "EndAttempt",
      ),
    ).toBe(false);
    const again = checks(run(result.model, { type: "FOCUS" }).model, type);
    expect(again.effects.filter((e) => e.type === "SetTimer")).toEqual([
      { type: "SetTimer", timer: "PROFILE_RECHECK", ms: 5000 },
    ]);
  },
);

test.each(["FOCUS", "DOCUMENT_VISIBLE", "PROFILE_RECHECK"] as const)(
  "%s repeats only one pending check",
  (type) => {
    const first = run(missing(), { type });
    expect(first.effects).toContainEqual({
      type: "CheckProfile",
      sessionId: 1,
      publicKey: "approved-key",
    });
    for (const event of ["FOCUS", "DOCUMENT_VISIBLE", "PROFILE_RECHECK"] as const)
      expect(run(first.model, { type: event }).effects).toEqual([]);
    const found = checks(first.model, "PROFILE_FOUND");
    expect(found.model.state.status).toBe("signed-in");
    expect(found.effects.some((e) => e.type === "EmitSession")).toBe(true);
  },
);

test("a hidden recheck timer does not read; becoming visible checks immediately", () => {
  const m = missing();
  expect(run(m, { type: "PROFILE_RECHECK" }, { visible: false })).toEqual({
    model: m,
    effects: [],
  });
  expect(run(m, { type: "DOCUMENT_VISIBLE" }).effects).toContainEqual({
    type: "CheckProfile",
    sessionId: 1,
    publicKey: "approved-key",
  });
});

test.each(["PROFILE_FOUND", "PROFILE_MISSING", "PROFILE_CHECK_FAILED"] as const)(
  "%s ignores stale and unsolicited results",
  (type) => {
    for (const m of [
      createAttemptModel(INSTANCE),
      opened(),
      held(),
      missing(),
      run(held(), { type: "CANCEL" }).model,
    ]) {
      expect(checks(m, type, 999)).toEqual({ model: m, effects: [] });
    }
    const m = missing();
    expect(checks(m, type)).toEqual({ model: m, effects: [] });
  },
);

test.each(["finishing", "needs-profile"] as const)(
  "%s revokes held Session on every unsuccessful end",
  (phase) => {
    for (const event of [
      { type: "CANCEL" },
      { type: "DISPOSE" },
      { type: "ATTEMPT_TIMEOUT" },
      { type: "RUNTIME_FAILED", error: new PassportError("internal") },
    ] satisfies AttemptEvent[]) {
      const m = phase === "finishing" ? held() : missing();
      const ended = run(m, event);
      expect(ended.effects.filter((e) => e.type === "RevokeSession")).toEqual([
        { type: "RevokeSession", sessionId: 1 },
      ]);
      expect(ended.effects.filter((e) => e.type === "EndAttempt")).toHaveLength(1);
      expect(ended.model.heldSession).toBeUndefined();
      if (event.type === "ATTEMPT_TIMEOUT")
        expect(ended.model.state).toMatchObject({
          status: "failed",
          error: { code: phase === "needs-profile" ? "profile_required" : "timeout" },
        });
      expect(checks(ended.model, "PROFILE_FOUND").effects).toEqual([]);
    }
  },
);

test.each(["finishing", "needs-profile"] as const)(
  "%s rejects duplicate approval before capabilities or profile reads",
  (phase) => {
    const m = phase === "finishing" ? held() : missing();
    for (const capabilitiesMatch of [true, false]) {
      const result = run(m, { ...session(1, 2), capabilitiesMatch } as AttemptEvent);
      expect(result.model.state).toBe(m.state);
      expect(result.model.heldSession).toBe(m.heldSession);
      expect(result.effects).toContainEqual({ type: "RevokeSession", sessionId: 2 });
      expect(result.effects).toContainEqual({
        type: "Diagnostic",
        code: "duplicate_session_revoked",
      });
      expect(
        result.effects.some((e) => e.type === "CheckProfile" || e.type === "EmitSession"),
      ).toBe(false);
    }
  },
);

test.each(["PROFILE_MISSING", "PROFILE_CHECK_FAILED"] as const)(
  "an optional profile still reads it once; %s signs in with no profile",
  (type) => {
    const m = opened();
    const held = run(m, session(m.flow!), { profile: "optional" });
    expect(held.model.state.status).toBe("finishing");
    expect(held.effects.filter((e) => e.type === "CheckProfile")).toHaveLength(1);
    const done = run(held.model, { type, sessionId: 1 }, { profile: "optional" });
    expect(done.model.state.status).toBe("signed-in");
    expect(done.effects).toContainEqual({
      type: "EmitSession",
      sessionId: 1,
      info: { ...held.model.heldSession!.info, profile: null, instance: INSTANCE.origin },
    });
    expect(done.effects.some((e) => e.type === "Diagnostic")).toBe(type === "PROFILE_CHECK_FAILED");
    expect(done.effects.some((e) => e.type === "SetTimer" && e.timer === "PROFILE_RECHECK")).toBe(
      false,
    );
  },
);

test("an optional profile that exists is returned with the Session", () => {
  const m = opened();
  const held = run(m, session(m.flow!), { profile: "optional" });
  const found = run(
    held.model,
    { type: "PROFILE_FOUND", sessionId: 1, profile: { name: "Approved" } },
    { profile: "optional" },
  );
  expect(found.effects).toContainEqual({
    type: "EmitSession",
    sessionId: 1,
    info: {
      ...held.model.heldSession!.info,
      profile: { name: "Approved" },
      instance: INSTANCE.origin,
    },
  });
});

test("capability mismatch never reads a profile", () => {
  const m = opened();
  const mismatch = run(m, { ...session(m.flow!), capabilitiesMatch: false } as AttemptEvent);
  expect(mismatch.model.state).toMatchObject({
    status: "failed",
    error: { code: "capability_mismatch" },
  });
  expect(mismatch.effects.some((e) => e.type === "CheckProfile")).toBe(false);
});

test("a ready Ring Session starts its own attempt, preserves the flow pin and clears QR timers", () => {
  const preparing = run(createAttemptModel(INSTANCE), { type: "PREPARE" }, { leases: 1 }).model;
  const ready = run(
    preparing,
    { type: "FLOW_CREATED", flowId: preparing.flow!, ringLink: LINK },
    { leases: 1 },
  ).model;
  const result = run(ready, session(ready.flow!));
  expect(result.model.state).toMatchObject({
    status: "finishing",
    via: "ring",
    instance: INSTANCE,
  });
  expect(result.effects).toContainEqual({
    type: "SetTimer",
    timer: "ATTEMPT",
    ms: CTX.timeouts.attemptMs,
  });
  expect(result.effects).toContainEqual({
    type: "ClearTimer",
    timers: expect.arrayContaining(["RING_ROTATE", "RING_PIN_ELAPSED", "HIDDEN_CAP"]),
  });
  expect(checks(result.model, "PROFILE_FOUND").model.state).toMatchObject({
    status: "signed-in",
    instance: INSTANCE,
  });
});

test("a passive late Session still needs a profile, while app-ended flows never read", () => {
  const m = opened();
  const failed = run(m, { type: "ATTEMPT_TIMEOUT" }).model;
  const late = run(failed, session(m.flow!));
  expect(late.model.state).toMatchObject({ status: "finishing", via: "popup" });
  expect(late.effects).toContainEqual({
    type: "SetTimer",
    timer: "ATTEMPT",
    ms: CTX.timeouts.attemptMs,
  });
  const cancelled = run(m, { type: "CANCEL" }).model;
  const appLate = run(cancelled, session(m.flow!));
  expect(appLate.effects.some((e) => e.type === "CheckProfile")).toBe(false);
  expect(appLate.effects).toContainEqual({ type: "RevokeSession", sessionId: 1 });
});

test("a newer active flow is released when its duplicate arrives while an older winner is held", () => {
  const first = opened();
  const ended = run(first, { type: "ATTEMPT_TIMEOUT" }).model;
  const second = run(ended, { type: "SIGN_IN", popup: W, instance: INSTANCE }).model;
  const active = run(second, { type: "FLOW_CREATED", flowId: second.flow!, ringLink: LINK }).model;
  const holdingOld = run(active, session(first.flow!, 1)).model;
  expect(holdingOld.flow).toBe(second.flow);
  const duplicate = run(holdingOld, session(second.flow!, 2));
  expect(duplicate.model.flow).toBeUndefined();
  expect(duplicate.model.heldSession).toBe(holdingOld.heldSession);
  expect(duplicate.model.flows.get(second.flow!)?.status).toBe("freeing");
  expect(duplicate.effects).toContainEqual({ type: "RevokeSession", sessionId: 2 });
  const found = checks(duplicate.model, "PROFILE_FOUND");
  expect(found.model.supersededThrough).toBe(second.flow);
  expect(found.effects.filter((effect) => effect.type === "EmitSession")).toEqual([
    {
      type: "EmitSession",
      sessionId: 1,
      info: {
        ...holdingOld.heldSession!.info,
        profile: { name: "Approved" },
        instance: INSTANCE.origin,
      },
    },
  ]);
});

test.each(["s", "c", "e", "none"] as const)(
  "resumed %s Session holds past the old finishing deadline",
  (marker) => {
    const returning = run(createAttemptModel(INSTANCE), {
      type: "RETURN_DETECTED",
      valid: true,
      marker,
      instance: INSTANCE,
      attemptId: "returned",
    }).model;
    const resumed = run(returning, { type: "RESUMED", flowId: returning.flow! }).model;
    const m = run(resumed, session(resumed.flow!)).model;
    expect(m.state).toMatchObject({ status: "finishing", via: "redirect" });
    expect(run(m, { type: "FINISHING_TIMEOUT" })).toEqual({ model: m, effects: [] });
    expect(checks(m, "PROFILE_FOUND").model.state).toMatchObject({
      status: "signed-in",
      instance: INSTANCE,
    });
  },
);

test.each(["resumed", "restored"] as const)(
  "%s redirect starts a fresh ATTEMPT deadline for its initial profile check (A34)",
  (path) => {
    let m: AttemptModel;
    if (path === "resumed") {
      m = run(createAttemptModel(INSTANCE), {
        type: "RETURN_DETECTED",
        valid: true,
        marker: "s",
        instance: INSTANCE,
        attemptId: "returned",
      }).model;
      m = run(m, { type: "RESUMED", flowId: m.flow! }).model;
    } else {
      m = run(createAttemptModel(INSTANCE), {
        type: "SIGN_IN",
        instance: INSTANCE,
        route: { kind: "redirect", cause: "preferred" },
      }).model;
      m = run(m, { type: "FLOW_CREATED", flowId: m.flow!, ringLink: LINK }).model;
      m = run(m, { type: "PAGE_RESTORED" }).model;
    }
    const held = run(m, session(m.flow!), { now: 123456 });
    expect(held.effects.filter((effect) => effect.type === "SetTimer")).toEqual([
      { type: "SetTimer", timer: "ATTEMPT", ms: CTX.timeouts.attemptMs },
    ]);
    const timeout = run(held.model, { type: "ATTEMPT_TIMEOUT" });
    expect(timeout.model.state).toMatchObject({ status: "failed", error: { code: "timeout" } });
    expect(timeout.effects).toContainEqual({ type: "RevokeSession", sessionId: 1 });
    expect(checks(timeout.model, "PROFILE_FOUND").effects).toEqual([]);
  },
);

/** A popup attempt whose Passport advertised `profile-setup`, with its Session held. */
function heldWithSetup() {
  const m = opened();
  const ready = run(m, { type: "READY", status: "valid", profileSetup: true }).model;
  expect(ready.profileSetup).toBe(true);
  return run(ready, session(ready.flow!)).model;
}

test("a missing profile is asked of a Passport that can create it, once, in its open window", () => {
  const asked = checks(heldWithSetup(), "PROFILE_MISSING");
  expect(asked.effects).toContainEqual({ type: "ProfileNeeded", publicKey: "approved-key" });
  expect(asked.effects.some((e) => e.type === "ClosePopup")).toBe(false);
  expect(asked.model.popup).toBe(W);
  expect(asked.model.state).toMatchObject({ status: "needs-profile", passport: "open" });
  // A later recheck that still finds none does not ask again or close the window.
  const again = checks(run(asked.model, { type: "PROFILE_RECHECK" }).model, "PROFILE_MISSING");
  expect(again.effects.some((e) => e.type === "ProfileNeeded" || e.type === "ClosePopup")).toBe(
    false,
  );
  expect(again.model.state).toMatchObject({ status: "needs-profile", passport: "open" });
});

test("profile-ready rereads quickly, and the found profile signs in and closes the window", () => {
  const asked = checks(heldWithSetup(), "PROFILE_MISSING").model;
  const ready = run(asked, { type: "PROFILE_READY" });
  expect(ready.effects).toContainEqual({
    type: "CheckProfile",
    sessionId: 1,
    publicKey: "approved-key",
  });
  // The homeserver may lag: another miss rereads after a second, not five.
  const lagging = checks(ready.model, "PROFILE_MISSING");
  expect(lagging.effects).toContainEqual({ type: "SetTimer", timer: "PROFILE_RECHECK", ms: 1000 });
  const found = checks(run(lagging.model, { type: "PROFILE_RECHECK" }).model, "PROFILE_FOUND");
  expect(found.model.state).toMatchObject({ status: "signed-in" });
  expect(found.effects).toContainEqual(
    expect.objectContaining({
      type: "EmitSession",
      info: expect.objectContaining({ profile: { name: "Approved" } }),
    }),
  );
  expect(found.effects.some((e) => e.type === "EndAttempt")).toBe(true);
  expect(found.effects.some((e) => e.type === "RevokeSession")).toBe(false);
});

test("closing Passport keeps the Session held; its button reopens the profile page", () => {
  const asked = checks(heldWithSetup(), "PROFILE_MISSING").model;
  const closed = run(asked, { type: "POPUP_CLOSED" });
  expect(closed.model.popup).toBeUndefined();
  expect(closed.model.heldSession?.sessionId).toBe(1);
  expect(closed.model.state).toMatchObject({ status: "needs-profile" });
  expect(closed.model.state).not.toHaveProperty("passport");
  expect(closed.effects.some((e) => e.type === "RevokeSession" || e.type === "EndAttempt")).toBe(
    false,
  );
  const window = {} as Window;
  const reopened = run(closed.model, { type: "PROFILE_WINDOW", popup: window });
  expect(reopened.model.popup).toBe(window);
  expect(reopened.model.state).toMatchObject({ status: "needs-profile", passport: "open" });
  expect(reopened.effects).toEqual([
    { type: "WatchPopup", popup: window },
    {
      type: "StartProfileHandshake",
      popup: window,
      origin: INSTANCE.origin,
      attemptId: "profile-attempt",
      publicKey: "approved-key",
    },
  ]);
  // A second window while one is open is not adopted (the runtime closes it).
  const second = run(reopened.model, { type: "PROFILE_WINDOW", popup: {} as Window });
  expect(second.model).toBe(reopened.model);
  expect(second.effects).toEqual([]);
});

test("cancel revokes a Session held for its profile and ends the attempt", () => {
  const asked = checks(heldWithSetup(), "PROFILE_MISSING").model;
  const cancelled = run(asked, { type: "CANCEL" });
  expect(cancelled.model.state).toMatchObject({ status: "idle" });
  expect(cancelled.effects).toContainEqual({ type: "RevokeSession", sessionId: 1 });
  expect(cancelled.effects.some((e) => e.type === "EndAttempt")).toBe(true);
  expect(cancelled.effects.some((e) => e.type === "EmitSession")).toBe(false);
});

test("without profile-setup, a missing profile closes Passport's window as before", () => {
  const closed = checks(held(), "PROFILE_MISSING");
  expect(closed.effects).toContainEqual({ type: "ClosePopup", popup: W });
  expect(closed.effects.some((e) => e.type === "ProfileNeeded")).toBe(false);
  expect(closed.model.state).not.toHaveProperty("passport");
});

test("the profile page's ready ends its hello loop, and unloading the app closes a held window", () => {
  const asked = checks(heldWithSetup(), "PROFILE_MISSING").model;
  const ready = run(asked, { type: "READY", status: "empty" });
  expect(ready.effects).toContainEqual({ type: "StopHandshake" });
  expect(ready.model.state).toMatchObject({ status: "needs-profile", passport: "open" });
  const hidden = run(asked, { type: "PAGE_HIDE", persisted: false });
  expect(hidden.effects).toContainEqual({ type: "ClosePopup", popup: W });
  const holding = heldWithSetup();
  expect(run(holding, { type: "PAGE_HIDE", persisted: false }).effects).toContainEqual({
    type: "ClosePopup",
    popup: W,
  });
});
