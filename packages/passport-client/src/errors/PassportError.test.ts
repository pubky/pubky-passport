import { expect, test } from "vitest";
import {
  errorAction,
  PassportError,
  PassportErrorCause,
  type PassportErrorCode,
} from "./PassportError.js";
const copies: Record<PassportErrorCode, string> = {
  popup_blocked:
    "Your browser blocked the Passport window. Allow pop-ups for this site, then try again.",
  popup_closed: "The Passport window was closed before sign-in finished.",
  cancelled: "Sign-in was cancelled.",
  passport_error: "Passport couldn't complete sign-in. Please try again.",
  request_rejected: "Passport couldn't read this sign-in request.",
  request_expired: "Passport took too long to open. Please try again.",
  request_ended:
    "Passport finished this request without returning to this app. Try again to sign in.",
  timeout: "Sign-in took too long. Please try again.",
  network: "Can't reach the Pubky network. Check your connection and try again.",
  identity_unresolved: "Couldn't find your homeserver. Try again in a moment.",
  approval_rejected:
    "Your approval couldn't be verified. Check that your device's date and time are correct, then try again.",
  capability_mismatch:
    "Passport granted different permissions than this app asked for. Please try again.",
  profile_required: "This app needs your Pubky profile. Finish it in Passport, then sign in again.",
  resume_failed: "We couldn't finish signing in in this tab. Please start again.",
  unsupported_environment: "Open this page in your browser to sign in.",
  internal: "Something went wrong while signing in. Please try again.",
};
test.each(Object.entries(copies) as [PassportErrorCode, string][])(
  "has stable copy and retry defaults for %s",
  (code, message) => {
    const error = new PassportError(code);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PassportError");
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    const unavailable = code === "unsupported_environment" || code === "request_rejected";
    expect(errorAction(code)).toBe(unavailable ? undefined : "retry");
    // No developer message or retry flags: the view decides what the button offers.
    for (const removed of ["devMessage", "retryable", "action"])
      expect(error).not.toHaveProperty(removed);
  },
);
test("uses contextual variants and the view's primary action", () => {
  expect(
    new PassportError("passport_error", { detail: { passportCode: "storage_unavailable" } })
      .message,
  ).toBe("Passport can't use this browser's storage.");
  const outdated = new PassportError("request_rejected", {
    detail: { rejection: "empty" },
    instance: { host: "custom.example", isCustom: true },
    context: { instanceHost: "custom.example", defaultHost: "default.example" },
  });
  expect(outdated.message).toBe(
    "Passport at custom.example didn't receive the request. It may be outdated.",
  );
  expect(errorAction(outdated.code, outdated.detail, true)).toBe("use-default-instance");
  expect(errorAction("request_rejected", { rejection: "invalid_relay" })).toBeUndefined();
  // A blocked pop-up continues in this tab by itself; when it cannot, the view offers a retry.
  expect(errorAction("popup_blocked")).toBe("retry");
  expect(errorAction("cancelled", { by: "app" })).toBe("sign-in");
});

test("uses pinned instance metadata rather than host inference for custom errors", () => {
  const defaultInstance = new PassportError("request_rejected", {
    detail: { rejection: "empty" },
    instance: { host: "my.example", isCustom: false },
  });
  expect(errorAction(defaultInstance.code, defaultInstance.detail, false)).toBe("retry");
  expect(defaultInstance.message).toBe(copies.request_rejected);
  const custom = new PassportError("request_rejected", {
    detail: { rejection: "empty" },
    instance: { host: "custom.example", isCustom: true },
    context: { instanceHost: "wrong.example" },
  });
  expect(errorAction(custom.code, custom.detail, true)).toBe("use-default-instance");
  expect(custom.message).toContain("custom.example");
  expect(custom.message).not.toContain("wrong.example");
});
test.each([false, true])("offers Retry for browser history failure, custom=%s", (isCustom) => {
  const options = {
    detail: { rejection: "history_unavailable" },
    instance: { host: "passport.example", isCustom },
  };
  const error = new PassportError("request_rejected", options);
  expect(error.message).toBe(
    "Passport couldn't open this request safely in this browser. Try again, or use another browser.",
  );
  expect(errorAction(error.code, error.detail, isCustom)).toBe("retry");
  expect(error.detail?.rejection).toBe("history_unavailable");
  expect(
    new PassportError("request_rejected", {
      ...options,
      messages: { "error.request_rejected.history_unavailable": "Try another browser" },
    }).message,
  ).toBe("Try another browser");
});
test("keeps an immutable sanitized cause and never stores the supplied Error", () => {
  const raw = Object.assign(new Error("private-" + "canary"), {
    name: "RequestError",
    data: { statusCode: 503, secret: "canary" },
  });
  const error = new PassportError("network", { cause: raw });
  expect(error.cause).toBeInstanceOf(PassportErrorCause);
  expect(error.cause).not.toBe(raw);
  expect(error.cause?.message).toBe("RequestError");
  expect(error.cause?.statusCode).toBe(503);
  for (const text of [
    String(error.cause),
    error.message,
    error.stack,
    error.cause?.stack,
    JSON.stringify(error),
  ])
    expect(text).not.toContain("canary");
  expect(Object.isFrozen(error.cause)).toBe(true);
});

test.each([false, true])(
  "request_ended offers Retry and overridable neutral copy, custom=%s",
  (isCustom) => {
    const error = new PassportError("request_ended", {
      instance: { host: "passport.example", isCustom },
      messages: { "error.request_ended": (context) => `Start again at ${context.instanceHost}` },
    });
    expect(error.message).toBe("Start again at passport.example");
    expect(errorAction(error.code, error.detail, isCustom)).toBe("retry");
    expect(error.detail).toBeUndefined();
  },
);
