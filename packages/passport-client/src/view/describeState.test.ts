import { expect, test } from "vitest";
import type { PassportState } from "../attempt/attemptModel.js";
import { errorAction, PassportError, type PassportAction } from "../errors/PassportError.js";
import { createRingLink } from "../shared/RingLink.js";
import { describePassportState } from "./describeState.js";
const instance = {
  origin: "https://passport.pubky.app",
  host: "passport.pubky.app",
  isCustom: false,
};
const custom = {
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
};
const base = { attemptId: "A".repeat(22), instance };
const ringLink = createRingLink(() => {
  throw new Error("must not reveal");
});
const waiting = {
  ...base,
  status: "waiting" as const,
  ringLink,
  handshake: "confirmed" as const,
  window: "open" as const,
};
const failure = (
  code: ConstructorParameters<typeof PassportError>[0],
  detail?: ConstructorParameters<typeof PassportError>[1],
) => ({ ...base, status: "failed" as const, error: new PassportError(code, detail) });
type Case = [
  string,
  PassportState,
  string,
  string | undefined,
  PassportAction | null,
  PassportAction[],
  string,
  boolean,
];
const cases: Case[] = [
  [
    "idle",
    { status: "idle", instance },
    "Continue with Pubky",
    undefined,
    "sign-in",
    [],
    "neutral",
    false,
  ],
  [
    "idle with error",
    { status: "idle", instance, lastError: new PassportError("network") },
    "Continue with Pubky",
    "Can't reach the Pubky network. Check your connection and try again.",
    "sign-in",
    [],
    "error",
    false,
  ],
  [
    "preparing",
    { status: "preparing", instance },
    "Continue with Pubky",
    undefined,
    "sign-in",
    [],
    "neutral",
    false,
  ],
  [
    "ready",
    { status: "ready", instance, ringLink },
    "Continue with Pubky",
    undefined,
    "sign-in",
    [],
    "neutral",
    false,
  ],
  [
    "opening",
    { ...base, status: "opening" },
    "Opening Passport…",
    "Opening Passport in a new window…",
    "focus",
    ["cancel"],
    "busy",
    true,
  ],
  [
    "confirmed open",
    waiting,
    "Continue in Passport",
    "Finish signing in in the Passport window.",
    "focus",
    ["cancel"],
    "busy",
    true,
  ],
  [
    "open Ring",
    { ...waiting, phase: "ring" },
    "Continue in Passport",
    "Approve the request in Pubky Ring.",
    "focus",
    ["cancel"],
    "busy",
    true,
  ],
  [
    "open granting",
    { ...waiting, phase: "granting" },
    "Continue in Passport",
    "Finishing in Passport…",
    "focus",
    [],
    "busy",
    true,
  ],
  [
    "unconfirmed open",
    { ...waiting, handshake: "unconfirmed", instance: custom },
    "Continue in Passport",
    "Passport at custom.example isn't responding yet.",
    "reopen",
    ["cancel", "use-default-instance"],
    "warning",
    true,
  ],
  [
    "closed Ring",
    { ...waiting, window: "closed", phase: "ring" },
    "Continue in Passport",
    "Waiting for Pubky Ring…",
    "reopen",
    ["cancel"],
    "busy",
    true,
  ],
  [
    "closed",
    { ...waiting, window: "closed" },
    "Continue in Passport",
    "Checking whether sign-in finished…",
    "reopen",
    ["cancel"],
    "busy",
    true,
  ],
  [
    "detached unreachable",
    { ...base, status: "detached", reason: "unreachable", ringLink, instance: custom },
    "Reopen Passport",
    "The Passport window was closed or blocked. Reopen it to continue.",
    "reopen",
    ["cancel", "use-default-instance"],
    "warning",
    true,
  ],
  [
    "detached request lost",
    { ...base, status: "detached", reason: "request-lost", ringLink, instance: custom },
    "Reopen Passport",
    "Passport lost this request. Reopen it to continue.",
    "reopen",
    ["cancel"],
    "warning",
    true,
  ],
  [
    "redirecting",
    { ...base, status: "redirecting" },
    "Continuing in this tab…",
    "Taking you to Passport…",
    null,
    [],
    "busy",
    true,
  ],
  [
    "finishing",
    { ...base, status: "finishing", via: "popup" },
    "Finishing sign-in…",
    "Almost done…",
    null,
    [],
    "busy",
    true,
  ],
  [
    "signed in",
    { ...base, status: "signed-in", publicKey: "public", instance: custom },
    "",
    undefined,
    null,
    [],
    "success",
    false,
  ],
  [
    "blocked",
    failure("popup_blocked"),
    "Try again",
    "Your browser blocked the Passport window. Allow pop-ups for this site, then try again.",
    "retry",
    [],
    "error",
    false,
  ],
  [
    "popup closed",
    failure("popup_closed"),
    "Try again",
    "The Passport window was closed before sign-in finished.",
    "retry",
    [],
    "error",
    false,
  ],
  [
    "cancelled by user",
    failure("cancelled", { detail: { by: "user" } }),
    "Try again",
    "Sign-in was cancelled.",
    "retry",
    [],
    "neutral",
    false,
  ],
  [
    "Passport failure",
    failure("passport_error"),
    "Try again",
    "Passport couldn't complete sign-in. Please try again.",
    "retry",
    [],
    "error",
    false,
  ],
  [
    "empty on custom",
    {
      ...failure("request_rejected", { detail: { rejection: "empty" }, instance: custom }),
      instance: custom,
    },
    "Try again",
    "Passport at custom.example didn't receive the request. It may be outdated.",
    "use-default-instance",
    ["retry", "reset-instance"],
    "error",
    false,
  ],
  [
    "empty on default",
    failure("request_rejected", { detail: { rejection: "empty" } }),
    "Try again",
    "Passport couldn't read this sign-in request.",
    "retry",
    [],
    "error",
    false,
  ],
  [
    "invalid request",
    failure("request_rejected", { detail: { rejection: "invalid_relay" } }),
    "Sign-in unavailable",
    "Passport couldn't read this sign-in request.",
    null,
    [],
    "error",
    false,
  ],
  [
    "browser history unavailable",
    failure("request_rejected", { detail: { rejection: "history_unavailable" } }),
    "Try again",
    "Passport couldn't open this request safely in this browser. Try again, or use another browser.",
    "retry",
    [],
    "error",
    false,
  ],
  [
    "retryable other",
    failure("timeout"),
    "Try again",
    "Sign-in took too long. Please try again.",
    "retry",
    [],
    "error",
    false,
  ],
  [
    "unsupported",
    failure("unsupported_environment"),
    "Sign-in unavailable",
    "Open this page in your browser to sign in.",
    null,
    [],
    "error",
    false,
  ],
  [
    "profile missing",
    { ...base, status: "needs-profile", publicKey: "public", check: "missing" },
    "Finish your profile",
    "This app needs your Pubky profile. Finish it in Passport to sign in.",
    "create-profile",
    ["cancel"],
    "warning",
    false,
  ],
  [
    "profile check error",
    { ...base, status: "needs-profile", publicKey: "public", check: "error" },
    "Finish your profile",
    "Couldn't check your Pubky profile. Trying again…",
    "create-profile",
    ["cancel"],
    "warning",
    false,
  ],
];
test.each(cases)("describes %s", (_name, state, label, status, primary, secondary, tone, busy) => {
  const view = describePassportState(state);
  expect(view).toMatchObject({ label, primary, secondary, tone, busy });
  expect(view.status).toBe(status);
  expect(view.hidden).toBe(state.status === "signed-in");
  if (state.status === "failed") {
    expect(errorAction(state.error.code, state.error.detail, state.instance.isCustom) ?? null).toBe(
      view.primary,
    );
    expect(state.error.message).toBe(view.status);
  }
  if (state.instance.isCustom && !view.hidden) {
    expect(view.notice).toBe("Using Passport at custom.example");
  } else {
    expect(view.notice).toBeUndefined();
  }
  expect(Object.keys(view.actionLabels)).toHaveLength(8);
});
test("keeps a last error through preparing and ready, but hides app cancellation", () => {
  for (const state of [
    { status: "preparing", instance },
    { status: "ready", instance, ringLink },
  ] as const) {
    expect(describePassportState({ ...state, lastError: new PassportError("network") }).tone).toBe(
      "error",
    );
    expect(
      describePassportState({
        ...state,
        lastError: new PassportError("cancelled", { detail: { by: "app" } }),
      }).status,
    ).toBeUndefined();
  }
  expect(describePassportState(failure("cancelled", { detail: { by: "app" } }))).toMatchObject({
    label: "Continue with Pubky",
    primary: "sign-in",
    tone: "neutral",
  });
});
test("adds reset for a user choice and default fallback only when unconfirmed", () => {
  expect(describePassportState({ status: "idle", instance }).secondary).toEqual([]);
  expect(describePassportState({ status: "idle", instance: custom }).secondary).toEqual([
    "reset-instance",
  ]);
  expect(
    describePassportState({
      ...waiting,
      window: "closed",
      handshake: "unconfirmed",
      instance: custom,
    }).secondary,
  ).toEqual(["cancel", "use-default-instance"]);
  expect(
    describePassportState({
      ...failure("popup_closed", { detail: { handshake: "unconfirmed" }, instance: custom }),
      instance: custom,
    }).secondary,
  ).toEqual(["use-default-instance", "reset-instance"]);
  expect(describePassportState({ ...failure("popup_closed"), instance: custom }).secondary).toEqual(
    ["reset-instance"],
  );
});

test("an invalid ready message without a parser code cannot be retried", () => {
  const state = failure("request_rejected");
  const view = describePassportState(state);
  expect(view).toMatchObject({ label: "Sign-in unavailable", primary: null });
  expect(errorAction(state.error.code, state.error.detail, state.instance.isCustom) ?? null).toBe(
    view.primary,
  );
  expect(state.error.message).toBe(view.status);
});

test("hides cancel after granting even when the popup closes", () => {
  expect(describePassportState({ ...waiting, window: "closed", phase: "granting" })).toMatchObject({
    primary: "reopen",
    secondary: [],
    status: "Checking whether sign-in finished…",
  });
});

test("uses the supplied developer default host for fallback action labels", () => {
  const configuredDefault = { ...instance, host: "my.example", origin: "https://my.example" };
  const defaultState = {
    ...failure("request_rejected", { detail: { rejection: "empty" }, instance: configuredDefault }),
    instance: configuredDefault,
  };
  const defaultView = describePassportState(defaultState, undefined, {
    defaultHost: configuredDefault.host,
  });
  expect(defaultView.primary).toBe("retry");
  expect(errorAction(defaultState.error.code, defaultState.error.detail)).toBe(defaultView.primary);
  expect(defaultState.error.message).toBe(defaultView.status);
  const view = describePassportState({ ...waiting, instance: custom }, undefined, {
    defaultHost: configuredDefault.host,
  });
  expect(view.actionLabels["use-default-instance"]).toBe("Use my.example");
  expect(view.actionLabels["reset-instance"]).toBe("Reset");
});

test("granting suppresses cancel even in an unconfirmed open view", () => {
  expect(
    describePassportState({
      ...waiting,
      handshake: "unconfirmed",
      phase: "granting",
      instance: custom,
    }).secondary,
  ).toEqual(["use-default-instance"]);
});
test("formats overrides through the single view function without revealing the Ring link", () => {
  const view = describePassportState(
    { ...waiting, instance: custom },
    {
      "label.waiting": "Anmelden",
      "notice.custom-instance": () => "",
      "action.cancel": "Abbrechen",
    },
  );
  expect(view.label).toBe("Anmelden");
  expect(view.notice).toContain("custom.example");
  expect(view.actionLabels.cancel).toBe("Abbrechen");
});
test("uses storage-specific copy and profile-required retry", () => {
  expect(
    describePassportState(
      failure("passport_error", { detail: { passportCode: "storage_unavailable" } }),
    ).status,
  ).toBe("Passport can't use this browser's storage.");
  expect(describePassportState(failure("profile_required"))).toMatchObject({
    primary: "retry",
    tone: "error",
  });
});
