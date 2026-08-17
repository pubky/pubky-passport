import { Result } from "better-result";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import type { AuthorizationEntry } from "../entry/authorizationEntry";
import {
  isPubkyAuthApprovalCapability,
  issueAuthorizationRequest,
  type PubkyAuthApprovalCapability,
} from "../request/issuedAuthorizationRequest";
import type {
  PassportAuthorizationController as PassportAuthorizationControllerContract,
  PassportAuthorizationViewState,
} from "../passportAuthorization";
import type { ApproveAuthorizationResult } from "./approveWithActiveIdentity";
import { AuthorizationFlowController } from "./authorizationFlowController";

type ControllerDependencies = ConstructorParameters<typeof AuthorizationFlowController>[1];

const RELAY_ORIGIN = "https://relay.example";
const SUCCESS_CALLBACK = "https://app.example/success?code=private";
const ERROR_CALLBACK = "https://app.example/error?code=private";
const CANCEL_CALLBACK = "https://app.example/cancel?code=private";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("AuthorizationFlowController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes only finite safe view states and intent methods", () => {
    expectTypeOf<PassportAuthorizationViewState["status"]>().not.toEqualTypeOf<string>();

    const controller = createController();
    const serializedState = JSON.stringify(controller.getState());
    const serializedController = JSON.stringify(controller);

    expect(controller.getState()).toMatchObject({
      status: "review",
      review: { requestingAppDisplayHost: "app.example" },
    });
    expect(serializedState).not.toContain(SECRET);
    expect(serializedState).not.toContain(SUCCESS_CALLBACK);
    expect(serializedController).not.toContain(SECRET);
    expect(serializedController).not.toContain(SUCCESS_CALLBACK);
    expect(serializedController).not.toContain(ERROR_CALLBACK);
    expect(serializedController).not.toContain(CANCEL_CALLBACK);
  });

  it("clears the pending authorization entry after the initial render commits", () => {
    const clearPendingEntry = vi.fn();
    const controller = createController({ clearPendingEntry });

    controller.commitInitialEntry();

    expect(clearPendingEntry).toHaveBeenCalledOnce();
  });

  it("approves once, completes the exact success callback, and releases provenance", async () => {
    let complete: ((result: ApproveAuthorizationResult) => void) | undefined;
    let capturedApproval: PubkyAuthApprovalCapability | undefined;
    const approveAuthorization = vi.fn((approval: PubkyAuthApprovalCapability) => {
      capturedApproval = approval;
      return new Promise<ApproveAuthorizationResult>((resolve) => { complete = resolve; });
    });
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
    expect(isPubkyAuthApprovalCapability(capturedApproval)).toBe(false);
  });

  it("routes approval errors and cancellation through exact validated callbacks", async () => {
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
  ] as const)("falls back to a local %s outcome when callback completion fails", async (_name, approveAuthorization, status, intent) => {
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

  it("exposes an expired entry as invalid", () => {
    const controller = createController({}, { status: "expired" });

    expect(controller.getState()).toEqual({ status: "invalid" });
  });
});

function createController(
  overrides: Partial<ControllerDependencies> = {},
  entry: AuthorizationEntry = validEntry(),
): PassportAuthorizationControllerContract {
  const dependencies: ControllerDependencies = {
    approveAuthorization: async () => Result.ok(),
    clearPendingEntry: vi.fn(),
    completeOutcome: vi.fn(async () => true),
    ...overrides,
  };
  return new AuthorizationFlowController(entry, dependencies);
}

function validEntry(options: { callbacks?: boolean } = {}): AuthorizationEntry {
  const parsed = issueAuthorizationRequest(encodeURIComponent(validRequest(options)));
  if (Result.isError(parsed)) throw new Error("Test authorization request must parse");
  return {
    status: "valid",
    review: parsed.value.review,
    approval: parsed.value.approval,
    expiresAt: Date.now() + 60_000,
  };
}

function validRequest(options: { callbacks?: boolean } = {}): string {
  const callbacks = options.callbacks === false
    ? ""
    : `&x-success=${encodeURIComponent(SUCCESS_CALLBACK)}&x-error=${encodeURIComponent(ERROR_CALLBACK)}&x-cancel=${encodeURIComponent(CANCEL_CALLBACK)}`;
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=${SECRET}${callbacks}`;
}
