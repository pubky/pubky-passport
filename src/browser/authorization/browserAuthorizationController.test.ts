/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { pubkyAuthRequestLimits } from "../../features/auth/pubkyAuthRequestLimits";
import type { ActiveAuthorizationResult } from "./approveActiveAuthorization";
import type { BrowserAuthorizationController, BrowserAuthorizationViewState } from "./browserAuthorizationController";
import {
  createBrowserAuthorizationControllerCore,
  type BrowserAuthorizationControllerDependencies,
} from "./browserAuthorizationControllerInternals";

const relayOrigin = "https://relay.example";
const successCallback = "https://app.example/success?code=private";
const errorCallback = "https://app.example/error?code=private";
const cancelCallback = "https://app.example/cancel?code=private";
const secret = "sensitive-authorization-secret";

describe("BrowserAuthorizationController", () => {
  afterEach(async () => {
    await Promise.resolve();
    window.history.replaceState({}, "", "/");
  });

  it("exposes only finite safe view states and intent methods", () => {
    expectTypeOf<BrowserAuthorizationViewState["status"]>().not.toEqualTypeOf<string>();
    setAuthorizationUrl(validRequest());

    const controller = createController();
    const serialized = JSON.stringify(controller.getState());

    expect(controller.getState()).toMatchObject({
      status: "review",
      review: { requestingAppDisplayName: "app.example" },
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(successCallback);
    expect(serialized).not.toContain(errorCallback);
    expect(serialized).not.toContain(cancelCallback);
    expect(Object.keys(controller).sort()).toEqual([]);
  });

  it("scrubs synchronously and preserves the parser-issued request across a StrictMode double initializer", async () => {
    const approveAuthorization = vi.fn(async () => Result.ok());
    setAuthorizationUrl(validRequest());

    const first = createController({ approveAuthorization });
    const second = createController({ approveAuthorization });

    expect(window.location.pathname).toBe("/authorize");
    expect(window.location.search).toBe("");
    expect(first.getState().status).toBe("review");
    expect(second.getState().status).toBe("review");
    await second.approve();
    expect(approveAuthorization).toHaveBeenCalledOnce();
  });

  it("bypasses framework-patched history methods while scrubbing", () => {
    setAuthorizationUrl(validRequest({ callbacks: false }));
    const frameworkReplaceState = vi.fn();
    Object.defineProperty(window.history, "replaceState", {
      configurable: true,
      value: frameworkReplaceState,
    });

    try {
      const controller = createController();
      expect(window.location.search).toBe("");
      expect(frameworkReplaceState).not.toHaveBeenCalled();
      expect(controller.getState().status).toBe("review");
    } finally {
      Reflect.deleteProperty(window.history, "replaceState");
    }
  });

  it("does not reuse an approval from an abandoned initializer after the pre-commit cache expires", async () => {
    setAuthorizationUrl(validRequest());
    createController();

    await Promise.resolve();
    window.history.replaceState({}, "", "/authorize");

    expect(createController().getState()).toEqual({ status: "invalid" });
  });

  it("clears the pre-commit cache when mounted", () => {
    setAuthorizationUrl(validRequest());
    const controller = createController();
    controller.mounted();

    expect(createController().getState()).toEqual({ status: "invalid" });
  });

  it.each([
    () => `d=${validRequest()}`,
    () => `d=${"%41".repeat(Math.ceil(pubkyAuthRequestLimits.encodedDLength / 3) + 1)}`,
    () => `d=${encodeURIComponent(validRequest())}&d=${encodeURIComponent(validRequest())}`,
    () => "d=%E0%A4%A",
  ])("rejects invalid raw d input without exposing it", (query) => {
    setRawAuthorizationQuery(query());

    const controller = createController();

    expect(window.location.search).toBe("");
    expect(controller.getState()).toEqual({ status: "invalid" });
  });

  it("approves once and navigates to the exact success callback", async () => {
    let complete: ((result: ActiveAuthorizationResult) => void) | undefined;
    const approveAuthorization = vi.fn(() => new Promise<ActiveAuthorizationResult>((resolve) => { complete = resolve; }));
    const navigate = vi.fn();
    setAuthorizationUrl(validRequest());
    const controller = createController({ approveAuthorization, navigate });

    const first = controller.approve();
    const second = controller.approve();
    expect(controller.getState().status).toBe("approving");
    expect(approveAuthorization).toHaveBeenCalledOnce();
    complete?.(Result.ok());

    await expect(first).resolves.toMatchObject({ status: "redirecting" });
    await expect(second).resolves.toMatchObject({ status: "approving" });
    expect(navigate).toHaveBeenCalledWith(successCallback);
  });

  it("routes approval errors and cancellation through exact parser-owned callbacks", async () => {
    const navigate = vi.fn();
    setAuthorizationUrl(validRequest());
    const failed = createController({
      approveAuthorization: async () => Result.err({ code: "approval_failed" }),
      navigate,
    });
    await failed.approve();
    expect(navigate).toHaveBeenLastCalledWith(errorCallback);

    setAuthorizationUrl(validRequest());
    const cancelled = createController({ navigate });
    cancelled.cancel();
    expect(navigate).toHaveBeenLastCalledWith(cancelCallback);
  });

  it.each([
    ["success", async () => Result.ok(), "approved", "approve"],
    ["error", async () => Result.err({ code: "approval_failed" as const }), "failed", "approve"],
    ["cancel", async () => Result.ok(), "cancelled", "cancel"],
  ] as const)("falls back to a local %s outcome when callback navigation throws", async (_name, approveAuthorization, status, intent) => {
    setAuthorizationUrl(validRequest());
    const controller = createController({
      approveAuthorization,
      navigate: () => { throw new Error("navigation unavailable"); },
    });

    const state = intent === "approve" ? await controller.approve() : controller.cancel();

    expect(state.status).toBe(status);
  });

  it.each(["no_active_identity", "identity_restore_failed", "approval_failed"] as const)(
    "retains the safe %s failure code without callbacks",
    async (code) => {
      setAuthorizationUrl(validRequest({ callbacks: false }));
      const controller = createController({ approveAuthorization: async () => Result.err({ code }) });

      await expect(controller.approve()).resolves.toEqual({ status: "failed", failureCode: code });
    },
  );

  it("makes approval, cancellation, and state listeners exception-total", async () => {
    setAuthorizationUrl(validRequest({ callbacks: false }));
    const controller = createController({
      approveAuthorization: async () => { throw new Error("approval exploded"); },
    });
    controller.subscribe(() => { throw new Error("listener exploded"); });

    await expect(controller.approve()).resolves.toEqual({ status: "failed", failureCode: "approval_failed" });
    expect(() => controller.cancel()).not.toThrow();
  });

  it("never approves or navigates an invalid request", async () => {
    const approveAuthorization = vi.fn(async () => Result.ok());
    const navigate = vi.fn();
    setAuthorizationUrl("pubkyauth://signin?secret=invalid-secret");
    const controller = createController({ approveAuthorization, navigate });

    await expect(controller.approve()).resolves.toEqual({ status: "invalid" });
    expect(controller.cancel()).toEqual({ status: "invalid" });
    expect(approveAuthorization).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

function createController(
  overrides: Partial<BrowserAuthorizationControllerDependencies> = {},
): BrowserAuthorizationController {
  return createBrowserAuthorizationControllerCore({
    browserWindow: window,
    relayOrigin,
    dependencies: {
      approveAuthorization: async () => Result.ok(),
      navigate: vi.fn(),
      ...overrides,
    },
  });
}

function setAuthorizationUrl(request: string): void {
  window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(request)}`);
}

function setRawAuthorizationQuery(query: string): void {
  window.history.replaceState({}, "", `/authorize?${query}`);
}

function validRequest(options: { callbacks?: boolean } = {}): string {
  const callbacks = options.callbacks === false
    ? ""
    : `&x-success=${encodeURIComponent(successCallback)}&x-error=${encodeURIComponent(errorCallback)}&x-cancel=${encodeURIComponent(cancelCallback)}`;
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${relayOrigin}/inbox`)}&secret=${secret}${callbacks}`;
}
