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
import type { RedirectCause } from "./chooseSignInRoute.js";

const INSTANCE = Object.freeze({
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
});
const WINDOW = Object.freeze({ name: "popup" }) as unknown as Window;
const LINK = createRingLink(() => "pubkyauth://" + "redirect-private-canary");
const TIMEOUTS = resolveClientOptions({}, (value) => value).timeouts;
const CONTEXT: AttemptContext = {
  defaultInstance: INSTANCE,
  attemptId: "new-attempt-01234567890",
  now: 1000,
  leases: 0,
  visible: true,
  profile: "optional",
  timeouts: TIMEOUTS,
};
const run = (model: AttemptModel, event: AttemptEvent, context: Partial<AttemptContext> = {}) =>
  attemptMachine(model, event, { ...CONTEXT, ...context });
const idle = () => createAttemptModel(INSTANCE);
const types = (result: ReturnType<typeof run>) => result.effects.map((effect) => effect.type);
const start = (cause: RedirectCause = "preferred", before = idle()) =>
  run(before, { type: "SIGN_IN", instance: INSTANCE, route: { kind: "redirect", cause } }).model;
const created = (cause: RedirectCause = "preferred", before = idle()) => {
  const m = start(cause, before);
  return run(m, { type: "FLOW_CREATED", flowId: m.flow!, ringLink: LINK }).model;
};
const prepared = () => run(idle(), { type: "PREPARE" }, { leases: 1 }).model;
const ready = () => {
  const m = prepared();
  return run(m, { type: "FLOW_CREATED", flowId: m.flow!, ringLink: LINK }, { leases: 1 }).model;
};
const returning = (marker: "s" | "c" | "e" | "none") =>
  run(idle(), {
    type: "RETURN_DETECTED",
    valid: true,
    marker,
    instance: INSTANCE,
    attemptId: "saved-attempt-01234567",
  }).model;

test.each(["preferred", "blocked"] as const)(
  "%s redirect creates its callback flow at once and saves before navigating",
  (cause) => {
    const result = run(idle(), {
      type: "SIGN_IN",
      instance: INSTANCE,
      route: { kind: "redirect", cause },
    });
    expect(result.model.state).toEqual({
      status: "redirecting",
      instance: INSTANCE,
      attemptId: CONTEXT.attemptId,
    });
    expect(result.model.redirectCause).toBe(cause);
    expect(result.effects).toContainEqual({
      type: "CreateFlow",
      flowId: result.model.flow,
      instance: INSTANCE,
      returnTo: CONTEXT.attemptId,
    });
    expect(result.model.flows.get(result.model.flow!)).toMatchObject({ via: "redirect" });
    expect(result.effects).toContainEqual({
      type: "SetTimer",
      timer: "ATTEMPT",
      ms: TIMEOUTS.attemptMs,
    });
    const saved = run(result.model, {
      type: "FLOW_CREATED",
      flowId: result.model.flow!,
      ringLink: LINK,
    });
    expect(saved.effects).toEqual([{ type: "SaveStateAndNavigate", flowId: result.model.flow }]);
    expect(types(saved)).not.toContain("FreeFlow");
    expect(types(saved)).not.toContain("StartPolling");
    expect(JSON.stringify(saved.model.state)).not.toContain("redirect-private-canary");
  },
);

test("a blocked pop-up that cannot continue in this tab fails with a diagnostic", () => {
  const result = run(idle(), {
    type: "SIGN_IN",
    instance: INSTANCE,
    route: { kind: "failed", code: "popup_blocked", diagnostic: "redirect_unavailable" },
  });
  expect(result.model.state).toMatchObject({ status: "failed", error: { code: "popup_blocked" } });
  expect(result.effects).toContainEqual({ type: "Diagnostic", code: "redirect_unavailable" });
  expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
  expect(types(result)).not.toContain("CreateFlow");
});

test("a blocked iframe fails without a same-tab continuation", () => {
  const result = run(idle(), {
    type: "SIGN_IN",
    instance: INSTANCE,
    route: { kind: "failed", code: "unsupported_environment" },
  });
  expect(result.model.state).toMatchObject({
    status: "failed",
    error: { code: "unsupported_environment" },
  });
  expect(types(result)).not.toContain("CreateFlow");
  expect(types(result)).not.toContain("Diagnostic");
});

test("routing away from preparation abandons it; a late creation is freed", () => {
  const before = prepared();
  const redirected = start("blocked", before);
  expect(redirected.flow).not.toBe(before.flow);
  expect(
    run(redirected, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK }).effects,
  ).toEqual([{ type: "FreeFlow", flowId: before.flow }]);
});

test("a ready QR keeps polling beside a fresh redirect flow and both end on failure", () => {
  const before = ready();
  const m = start("blocked", before);
  expect(m.flow).not.toBe(before.flow);
  expect(m.redirectQr).toBe(before.flow);
  expect(m.flows.get(before.flow!)?.status).toBe("polling");
  expect(m.flows.get(m.flow!)?.via).toBe("redirect");
  const result = run(m, {
    type: "FLOW_FAILED",
    flowId: m.flow!,
    error: new PassportError("network"),
  });
  expect(result.model.state).toMatchObject({ status: "failed", error: { code: "network" } });
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: m.flow });
  expect(result.effects).toContainEqual({
    type: "RetireFlow",
    flowId: before.flow,
    ms: TIMEOUTS.ringGraceMs,
  });
});

test.each(["blocked", "preferred"] as const)("%s save failure ends the attempt once", (cause) => {
  const before = created(cause);
  const result = run(before, { type: "REDIRECT_SAVE_FAILED" });
  expect(result.model.state).toMatchObject({
    status: "failed",
    error: { code: cause === "blocked" ? "popup_blocked" : "unsupported_environment" },
  });
  expect(result.effects).toContainEqual({ type: "Diagnostic", code: "redirect_unavailable" });
  expect(result.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
  expect(types(result).filter((type) => type === "EndAttempt")).toHaveLength(1);
});

test("bfcache restores the same handle without resuming and no-marker timeout is silent", () => {
  const before = created();
  const restored = run(before, { type: "PAGE_RESTORED" });
  expect(restored.model.state).toMatchObject({ status: "finishing", via: "redirect" });
  expect(restored.effects).toEqual([
    { type: "DeleteRedirectState" },
    { type: "StartPolling", flowId: before.flow },
    { type: "SetTimer", timer: "FINISHING", ms: 10000 },
  ]);
  expect(run(restored.model, { type: "PAGE_RESTORED" }).effects).toEqual([]);
  const result = run(restored.model, { type: "FINISHING_TIMEOUT" });
  expect(result.model.state).toEqual({ status: "idle", instance: INSTANCE });
  // A36: the state stays silent, while a signIn waiting on this attempt settles resume_failed.
  const ends = result.effects.filter((effect) => effect.type === "EndAttempt");
  expect(ends).toEqual([
    {
      type: "EndAttempt",
      by: "passive",
      error: expect.objectContaining({ code: "resume_failed" }),
    },
  ]);
  expect(types(result)).not.toContain("Diagnostic");
});

test.each(["s", "c", "e", "none"] as const)(
  "return marker %s resumes once and uses its grace",
  (marker) => {
    const started = run(idle(), {
      type: "RETURN_DETECTED",
      valid: true,
      marker,
      instance: INSTANCE,
      attemptId: "saved-attempt-01234567",
    });
    expect(started.model.state).toMatchObject({
      status: "finishing",
      via: "redirect",
      attemptId: "saved-attempt-01234567",
    });
    expect(started.effects).toEqual([{ type: "ResumeFlow", flowId: started.model.flow }]);
    const resumed = run(started.model, { type: "RESUMED", flowId: started.model.flow! });
    expect(resumed.effects).toEqual([
      { type: "StartPolling", flowId: started.model.flow },
      {
        type: "SetTimer",
        timer: "FINISHING",
        ms: marker === "s" ? TIMEOUTS.finishingMs : marker === "none" ? 10000 : 3000,
      },
    ]);
    expect(run(resumed.model, { type: "RESUMED", flowId: started.model.flow! }).effects).toEqual(
      [],
    );
    const result = run(resumed.model, { type: "FINISHING_TIMEOUT" });
    expect(result.effects).toContainEqual({
      type: "EndAttempt",
      by: "passive",
      error: expect.objectContaining({
        code: marker === "s" || marker === "none" ? "resume_failed" : expect.any(String),
      }),
    });
    if (marker === "none")
      expect(result.model.state).toEqual({ status: "idle", instance: INSTANCE });
    else
      expect(result.model.state).toMatchObject({
        status: "failed",
        error: {
          code: marker === "s" ? "resume_failed" : marker === "c" ? "cancelled" : "passport_error",
        },
      });
  },
);

test("a bad matching record and a failed resume report resume_failed", () => {
  const bad = run(idle(), { type: "RETURN_DETECTED", valid: false });
  expect(bad.model.state).toMatchObject({ status: "failed", error: { code: "resume_failed" } });
  const before = returning("s");
  const failed = run(before, { type: "RESUME_FAILED", flowId: before.flow! });
  expect(failed.model.state).toMatchObject({ status: "failed", error: { code: "resume_failed" } });
  expect(failed.effects).toContainEqual({ type: "FreeFlow", flowId: before.flow });
});

test("a late resumed handle after cancellation or dispose is freed", () => {
  for (const type of ["CANCEL", "DISPOSE"] as const) {
    const before = returning("s");
    const ended = run(before, { type }).model;
    expect(run(ended, { type: "RESUMED", flowId: before.flow! }).effects).toEqual([
      { type: "FreeFlow", flowId: before.flow },
    ]);
  }
});

test("redirecting pagehide does not close a window or free the saved handle", () => {
  const before = created();
  for (const persisted of [true, false])
    expect(run(before, { type: "PAGE_HIDE", persisted })).toEqual({ model: before, effects: [] });
});

test("a companion QR poll failure frees only that flow and keeps the redirect active", () => {
  const before = start("blocked", ready());
  const result = run(before, {
    type: "POLL_FAILED",
    flowId: before.redirectQr!,
    error: new PassportError("network"),
  });
  expect(result.model.state).toBe(before.state);
  expect(result.model.flow).toBe(before.flow);
  expect(result.model.redirectQr).toBeUndefined();
  expect(result.effects).toEqual([{ type: "FreeFlow", flowId: before.redirectQr }]);
  expect(before.flows.get(before.redirectQr!)?.status).toBe("polling");
});

test.each(["CANCEL", "DISPOSE"] as const)(
  "%s ends both redirect and companion flows by the app",
  (type) => {
    const before = start("blocked", ready());
    const result = run(before, { type });
    for (const flowId of [before.flow!, before.redirectQr!]) {
      expect(result.model.flows.get(flowId)?.endedBy).toBe("app");
      expect(
        result.effects.filter((effect) => effect.type === "FreeFlow" && effect.flowId === flowId),
      ).toHaveLength(1);
    }
    expect(result.model.redirectQr).toBeUndefined();
    expect(result.model.redirectCause).toBeUndefined();
    expect(result.model.state).toEqual({ status: "idle", instance: INSTANCE });
  },
);

test("a return pins its recorded instance and formats failures there without changing the app's selection", () => {
  const custom = {
    origin: "https://custom.example",
    host: "custom.example",
    isCustom: true,
  };
  const before = run(idle(), {
    type: "RETURN_DETECTED",
    valid: true,
    marker: "s",
    instance: custom,
    attemptId: "saved-custom-attempt",
  }).model;
  expect(before.state.instance).toBe(custom);
  expect(before.selection).toBe(INSTANCE);
  expect(before.flows.get(before.flow!)?.instance).toBe(custom);
  const failed = run(
    before,
    { type: "RESUME_FAILED", flowId: before.flow! },
    { messages: { "error.resume_failed": "Return from {instanceHost} failed" } },
  );
  expect(failed.model.state).toMatchObject({
    error: { message: "Return from custom.example failed" },
  });
  expect(run(failed.model, { type: "RESET" }).model.state).toEqual({
    status: "idle",
    instance: INSTANCE,
  });
});

test("a new route during a live attempt is ignored", () => {
  const before = start();
  const attempted = run(before, {
    type: "SIGN_IN",
    instance: INSTANCE,
    route: { kind: "redirect", cause: "blocked" },
  });
  expect(attempted).toEqual({ model: before, effects: [] });
});

const CUSTOM = Object.freeze({
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
});
const ROUTES = [
  { kind: "redirect", cause: "blocked" },
  { kind: "redirect", cause: "preferred" },
] as const;
const ORIGINS = [
  { name: "C to D", from: CUSTOM, to: INSTANCE },
  { name: "D to C", from: INSTANCE, to: CUSTOM },
] as const;
function preparationAt(instance: typeof INSTANCE | typeof CUSTOM, complete: boolean) {
  const preparing = run(
    createAttemptModel(instance),
    { type: "PREPARE" },
    {
      leases: 1,
      attemptId: "lease-before-route",
    },
  ).model;
  return complete
    ? run(
        preparing,
        { type: "FLOW_CREATED", flowId: preparing.flow!, ringLink: LINK },
        { leases: 1 },
      ).model
    : preparing;
}

for (const { name, from, to } of ORIGINS) {
  test.each(ROUTES)(`${name}: %j preserves the old ready origin and starts fresh`, (route) => {
    const before = preparationAt(from, true);
    const started = run(before, { type: "SIGN_IN", instance: to, route });
    expect(started.model.state.instance).toBe(to);
    expect(started.model.flows.get(before.flow!)).toEqual({
      ...before.flows.get(before.flow!),
      status: "draining",
      endedBy: "passive",
    });
    expect(started.effects.filter((effect) => /Flow$/u.test(effect.type))).toEqual([
      { type: "RetireFlow", flowId: before.flow, ms: TIMEOUTS.ringGraceMs },
      {
        type: "CreateFlow",
        flowId: before.lastFlowId + 1,
        instance: to,
        returnTo: CONTEXT.attemptId,
      },
    ]);
    expect(started.model.redirectQr).toBeUndefined();
    expect(started.model.flows.get(before.flow!)?.instance).toBe(from);
    expect(started.model.flows.get(started.model.flow!)?.instance).toBe(to);
    expect(JSON.stringify(started)).not.toContain("redirect-private-canary");
  });

  test(`${name}: a pop-up attempt also starts fresh on the new origin`, () => {
    const before = preparationAt(from, true);
    const started = run(before, { type: "SIGN_IN", instance: to, popup: WINDOW });
    expect(started.effects).toContainEqual({
      type: "CreateFlow",
      flowId: before.lastFlowId + 1,
      instance: to,
    });
    const created = run(started.model, {
      type: "FLOW_CREATED",
      flowId: started.model.flow!,
      ringLink: LINK,
    });
    expect(created.effects).toContainEqual({
      type: "NavigatePopup",
      flowId: started.model.flow,
      popup: WINDOW,
      origin: to.origin,
    });
    expect(created.effects).toContainEqual({
      type: "StartHandshake",
      popup: WINDOW,
      origin: to.origin,
      attemptId: CONTEXT.attemptId,
      flowId: expect.any(Number),
    });
  });

  test.each(ROUTES)(`${name}: %j abandons an in-progress preparation`, (route) => {
    const before = preparationAt(from, false);
    const result = run(before, { type: "SIGN_IN", instance: to, route });
    expect(result.model.flow).toBe(before.lastFlowId + 1);
    expect(result.model.flows.get(before.flow!)).toEqual({
      ...before.flows.get(before.flow!),
      status: "freeing",
      endedBy: "abandoned",
    });
    expect(result.effects.filter((effect) => /Flow$/u.test(effect.type))).toEqual([
      { type: "FreeFlow", flowId: before.flow },
      { type: "CreateFlow", flowId: result.model.flow, instance: to, returnTo: CONTEXT.attemptId },
    ]);
    expect(
      run(result.model, { type: "FLOW_CREATED", flowId: before.flow!, ringLink: LINK }).effects,
    ).toEqual([{ type: "FreeFlow", flowId: before.flow }]);
  });
}

test.each(ROUTES)("same-origin %j keeps the ready code as its companion", (route) => {
  const before = ready();
  const selection = { ...INSTANCE };
  const result = run(before, { type: "SIGN_IN", instance: selection, route });
  expect(result.model.redirectQr).toBe(before.flow);
  expect(result.model.state.instance).toBe(selection);
  expect(result.model.flows.get(before.flow!)).toEqual({
    ...before.flows.get(before.flow!),
    attemptId: CONTEXT.attemptId,
  });
  expect(result.model.flows.get(before.flow!)?.instance).toBe(INSTANCE);
  expect(result.effects.filter((effect) => /Flow$/u.test(effect.type))).toEqual([
    {
      type: "CreateFlow",
      flowId: result.model.flow,
      instance: selection,
      returnTo: CONTEXT.attemptId,
    },
  ]);
});

test.each(ROUTES)(
  "%j adoption clears all deferred lease flags and protects the companion",
  (route) => {
    let before = run(ready(), { type: "RING_OPENED" }, { leases: 1 }).model;
    before = run(before, { type: "RING_ROTATE" }, { leases: 1, visible: false }).model;
    before = run(before, { type: "HIDDEN_CAP" }, { leases: 1, visible: false }).model;
    expect(before).toMatchObject({ ringPinned: true, rotateDue: true, capDue: true });
    const adopted = run(before, { type: "SIGN_IN", instance: INSTANCE, route }).model;
    expect(adopted).toMatchObject({ ringPinned: false, rotateDue: false, capDue: false });
    for (const visible of [true, false]) {
      for (const type of [
        "DOCUMENT_VISIBLE",
        "RING_PIN_ELAPSED",
        "RING_ROTATE",
        "HIDDEN_CAP",
      ] as const) {
        expect(run(adopted, { type }, { visible, leases: 1 })).toEqual({
          model: adopted,
          effects: [],
        });
      }
    }
    expect(adopted.flows.get(before.flow!)?.status).toBe("polling");
  },
);
