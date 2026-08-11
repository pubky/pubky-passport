import { Result } from "better-result";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { LOGGER } from "../../libs/logger/logger";
import type { ApproveAuthorizationResult } from "./approveAuthorizationWithActiveIdentity";
import type { AuthorizationEntry } from "./browserAuthorizationEntry";
import { parseBrowserAuthorizationRequest } from "./browserAuthorizationRequest";
import type {
  PassportAuthorizationController as PassportAuthorizationControllerContract,
  PassportAuthorizationViewState,
} from "./passportAuthorization";
import { PassportAuthorizationController } from "./passportAuthorizationController";

type ControllerDependencies = ConstructorParameters<typeof PassportAuthorizationController>[0]["dependencies"];

const RELAY_ORIGIN = "https://relay.example";
const SUCCESS_CALLBACK = "https://app.example/success?code=private";
const ERROR_CALLBACK = "https://app.example/error?code=private";
const CANCEL_CALLBACK = "https://app.example/cancel?code=private";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("PassportAuthorizationController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes only finite safe view states and intent methods", () => {
    expectTypeOf<PassportAuthorizationViewState["status"]>().not.toEqualTypeOf<string>();

    const controller = createController();
    const serialized = JSON.stringify(controller.getState());

    expect(controller.getState()).toMatchObject({
      status: "review",
      review: { requestingAppDisplayHost: "app.example" },
    });
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(SUCCESS_CALLBACK);
    expect(serialized).not.toContain(ERROR_CALLBACK);
    expect(serialized).not.toContain(CANCEL_CALLBACK);
    expect(Object.keys(controller).sort()).toEqual([]);
  });

  it("clears the pending authorization entry after the initial render commits", () => {
    const clearPendingEntry = vi.fn();
    const controller = createController({ clearPendingEntry });

    controller.commitInitialEntry();

    expect(clearPendingEntry).toHaveBeenCalledOnce();
  });

  it("approves once and completes the exact success callback", async () => {
    let complete: ((result: ApproveAuthorizationResult) => void) | undefined;
    const approveAuthorization = vi.fn(() => new Promise<ApproveAuthorizationResult>((resolve) => { complete = resolve; }));
    const completeOutcome = vi.fn(async () => true);
    const controller = createController({ approveAuthorization, completeOutcome });

    const first = controller.approve();
    const second = controller.approve();
    expect(controller.getState().status).toBe("approving");
    expect(approveAuthorization).toHaveBeenCalledOnce();
    complete?.(Result.ok());

    await expect(first).resolves.toMatchObject({ status: "redirecting" });
    await expect(second).resolves.toMatchObject({ status: "approving" });
    expect(completeOutcome).toHaveBeenCalledWith(SUCCESS_CALLBACK, "success");
  });

  it("routes approval errors and cancellation through exact browser-owned callbacks", async () => {
    const completeOutcome = vi.fn(async () => true);
    const failed = createController({
      approveAuthorization: async () => Result.err({ code: "approval_failed" }),
      completeOutcome,
    });
    await failed.approve();
    expect(completeOutcome).toHaveBeenLastCalledWith(ERROR_CALLBACK, "error");

    const cancelled = createController({ completeOutcome });
    await cancelled.cancel();
    expect(completeOutcome).toHaveBeenLastCalledWith(CANCEL_CALLBACK, "cancel");
  });

  it.each([
    ["success", async () => Result.ok(), "approved", "approve"],
    ["error", async () => Result.err({ code: "approval_failed" as const }), "failed", "approve"],
    ["cancel", async () => Result.ok(), "cancelled", "cancel"],
  ] as const)("falls back to a local %s outcome when browser completion fails", async (_name, approveAuthorization, status, intent) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const controller = createController({
      approveAuthorization,
      completeOutcome: async () => false,
    });

    const state = intent === "approve" ? await controller.approve() : await controller.cancel();

    expect(state.status).toBe(status);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.callback.failed", {
      outcome: _name,
      operation: "complete",
    });
  });

  it.each(["no_active_identity", "identity_restore_failed", "approval_failed"] as const)(
    "retains the safe %s failure code without callbacks",
    async (code) => {
      const controller = createController(
        { approveAuthorization: async () => Result.err({ code }) },
        validEntry({ callbacks: false }),
      );

      await expect(controller.approve()).resolves.toEqual({ status: "failed", failureCode: code });
    },
  );

  it("makes approval, cancellation, and state listeners exception-total", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const controller = createController(
      { approveAuthorization: async () => { throw new Error("approval exploded"); } },
      validEntry({ callbacks: false }),
    );
    controller.subscribe(() => { throw new Error("listener exploded"); });

    await expect(controller.approve()).resolves.toEqual({ status: "failed", failureCode: "approval_failed" });
    await expect(controller.cancel()).resolves.toEqual({ status: "failed", failureCode: "approval_failed" });
    expect(warning).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "controller",
      code: "unexpected_failure",
    });
    expect(warning).toHaveBeenCalledWith("authorize.state_listener.failed", { state: "approving" });
  });

  it("never approves or completes an invalid request", async () => {
    const approveAuthorization = vi.fn(async () => Result.ok());
    const completeOutcome = vi.fn(async () => true);
    const controller = createController({ approveAuthorization, completeOutcome }, { status: "invalid" });

    await expect(controller.approve()).resolves.toEqual({ status: "invalid" });
    await expect(controller.cancel()).resolves.toEqual({ status: "invalid" });
    expect(approveAuthorization).not.toHaveBeenCalled();
    expect(completeOutcome).not.toHaveBeenCalled();
  });

  it("exposes an empty entry as manual authorization", () => {
    const controller = createController({}, { status: "empty" });

    expect(controller.getState()).toEqual({ status: "manual-entry" });
  });
});

function createController(
  overrides: Partial<ControllerDependencies> = {},
  entry: AuthorizationEntry = validEntry(),
): PassportAuthorizationControllerContract {
  return new PassportAuthorizationController({
    entry,
    dependencies: {
      approveAuthorization: async () => Result.ok(),
      clearPendingEntry: vi.fn(),
      completeOutcome: vi.fn(async () => true),
      ...overrides,
    },
  });
}

function validEntry(options: { callbacks?: boolean } = {}): AuthorizationEntry {
  const parsed = parseBrowserAuthorizationRequest(encodeURIComponent(validRequest(options)));
  if (Result.isError(parsed)) throw new Error("Test authorization request must parse");
  return { status: "valid", review: parsed.value.review, approval: parsed.value.approval };
}

function validRequest(options: { callbacks?: boolean } = {}): string {
  const callbacks = options.callbacks === false
    ? ""
    : `&x-success=${encodeURIComponent(SUCCESS_CALLBACK)}&x-error=${encodeURIComponent(ERROR_CALLBACK)}&x-cancel=${encodeURIComponent(CANCEL_CALLBACK)}`;
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=${SECRET}${callbacks}`;
}
