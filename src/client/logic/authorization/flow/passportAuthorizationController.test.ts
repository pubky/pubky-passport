/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import type { AuthorizationEntry } from "../entry/authorizationEntry";
import { IssuedPubkyAuthRequest } from "../request/IssuedPubkyAuthRequest";
import type { AuthorizationOutcome } from "./authorizationOutcomeHandoff";
import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "./PassportAuthorizationController";

const MOCKS = vi.hoisted(() => ({
  approveAuthorization: vi.fn(),
  handoffAuthorizationOutcome: vi.fn(),
}));

vi.mock("./approveAuthorization", () => ({
  approveAuthorization: MOCKS.approveAuthorization,
}));

vi.mock("./authorizationOutcomeHandoff", async (importOriginal) => ({
  ...await importOriginal<typeof import("./authorizationOutcomeHandoff")>(),
  handoffAuthorizationOutcome: MOCKS.handoffAuthorizationOutcome,
}));

type ControllerOverrides = {
  handoffOutcome: (
    appWindow: Window,
    callback: string,
    outcome: AuthorizationOutcome,
    signal: AbortSignal,
  ) => Promise<boolean>;
};

type EntryOptions = {
  callbacks?: boolean;
  status?: "valid" | "invalid" | "empty" | "expired";
};

const SUCCESS_CALLBACK = "https://app.example/success?code=private";
const ERROR_CALLBACK = "https://app.example/error?code=private";
const CANCEL_CALLBACK = "https://app.example/cancel?code=private";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const SELECTED_IDENTITY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

describe("PassportAuthorizationController", () => {
  beforeEach(() => {
    for (const mock of Object.values(MOCKS)) mock.mockReset();
    MOCKS.approveAuthorization.mockResolvedValue(Result.ok());
    MOCKS.handoffAuthorizationOutcome.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exposes only finite safe view states and intent methods", () => {
    expectTypeOf<PassportAuthorizationViewState["status"]>().not.toEqualTypeOf<string>();

    const { controller } = createController();
    const serializedState = JSON.stringify(controller.getState());

    expect(controller.getState()).toMatchObject({
      status: "review",
      review: { callbackHost: "app.example" },
    });
    expect(serializedState).not.toContain(SECRET);
    expect(serializedState).not.toContain(SUCCESS_CALLBACK);
  });

  it("approves once with the reviewed identity and completes the success callback", async () => {
    let completeApproval: (() => void) | undefined;
    let capturedRequest: IssuedPubkyAuthRequest | undefined;
    MOCKS.approveAuthorization.mockImplementation((request) => {
      capturedRequest = request;
      return new Promise((resolve) => {
        completeApproval = () => resolve(Result.ok());
      });
    });
    const handoffOutcome = vi.fn(async () => true);
    const { controller } = createController({ handoffOutcome });

    const first = controller.approve(SELECTED_IDENTITY);
    const second = controller.approve("other-public-key");

    expect(controller.getState().status).toBe("approving");
    await vi.waitFor(() => expect(MOCKS.approveAuthorization).toHaveBeenCalledOnce());
    expect(MOCKS.approveAuthorization).toHaveBeenCalledWith(
      capturedRequest,
      SELECTED_IDENTITY,
    );
    completeApproval?.();

    await expect(first).resolves.toMatchObject({ status: "completing" });
    await expect(second).resolves.toMatchObject({ status: "approving" });
    expect(handoffOutcome).toHaveBeenCalledWith(
      window,
      SUCCESS_CALLBACK,
      "success",
      expect.anything(),
    );
    expect(IssuedPubkyAuthRequest.isLive(capturedRequest)).toBe(false);
  });

  it("routes approval errors and cancellation through exact validated callbacks", async () => {
    const handoffOutcome = vi.fn(async () => true);
    MOCKS.approveAuthorization.mockResolvedValueOnce(Result.err({ code: "approval_failed" }));
    const failed = createController({ handoffOutcome }).controller;
    await failed.approve(SELECTED_IDENTITY);
    expect(handoffOutcome).toHaveBeenLastCalledWith(
      window,
      ERROR_CALLBACK,
      "error",
      expect.anything(),
    );

    const cancelled = createController({ handoffOutcome }).controller;
    await cancelled.cancel();
    expect(handoffOutcome).toHaveBeenLastCalledWith(
      window,
      CANCEL_CALLBACK,
      "cancel",
      expect.anything(),
    );
  });

  it.each([
    ["success", false, "approved", "approve"],
    ["error", true, "failed", "approve"],
    ["cancel", false, "cancelled", "cancel"],
  ] as const)("falls back to a local %s outcome when callback completion fails", async (
    outcome,
    approvalFails,
    status,
    intent,
  ) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    if (approvalFails) {
      MOCKS.approveAuthorization.mockResolvedValueOnce(Result.err({ code: "approval_failed" }));
    }
    const { controller } = createController({ handoffOutcome: async () => false });

    const state = intent === "approve"
      ? await controller.approve(SELECTED_IDENTITY)
      : await controller.cancel();

    expect(state.status).toBe(status);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.callback.failed", {
      outcome,
      operation: "complete",
    });
  });

  it("uses one render state for approval failure", async () => {
    MOCKS.approveAuthorization.mockResolvedValueOnce(Result.err({
      code: "approval_failed",
      cause: new Error(SECRET),
    }));
    const { controller } = createController({}, { callbacks: false });

    const state = await controller.approve(SELECTED_IDENTITY);

    expect(state).toEqual({ status: "failed" });
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(state).not.toHaveProperty("cause");
  });

  it("contains handoff exceptions without exposing them to view state", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const handoffError = new TypeError(`handoff failed ${SECRET} ${SUCCESS_CALLBACK}`);
    const { controller } = createController({
      handoffOutcome: async () => { throw handoffError; },
    });

    const state = await controller.approve(SELECTED_IDENTITY);

    expect(state).toEqual({ status: "approved" });
    expect(state).not.toHaveProperty("cause");
    expect(warning).toHaveBeenCalledWith("authorize.callback.failed", {
      outcome: "success",
      operation: "complete",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SUCCESS_CALLBACK);
  });

  it("makes state listeners exception-total", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller } = createController({}, { callbacks: false });
    controller.subscribe(() => { throw new Error("listener exploded"); });

    await expect(controller.cancel()).resolves.toEqual({ status: "cancelled" });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.state_listener.failed", {
      state: "cancelled",
    });
  });

  it("releases an abandoned request without completing its callback", async () => {
    let completeApproval: (() => void) | undefined;
    MOCKS.approveAuthorization.mockImplementationOnce(() =>
      new Promise((resolve) => {
        completeApproval = () => resolve(Result.ok());
      })
    );
    const handoffOutcome = vi.fn(async () => true);
    const { controller, entry } = createController({ handoffOutcome });
    if (entry.status !== "valid") throw new Error("Expected a valid entry");
    const approval = controller.approve(SELECTED_IDENTITY);
    await vi.waitFor(() => expect(MOCKS.approveAuthorization).toHaveBeenCalledOnce());

    controller.dispose();
    completeApproval?.();

    await expect(approval).resolves.toEqual({
      status: "approving",
      review: entry.request.review,
    });
    expect(IssuedPubkyAuthRequest.isLive(entry.request)).toBe(false);
    expect(handoffOutcome).not.toHaveBeenCalled();
  });

  it("aborts callback completion when the controller is abandoned", async () => {
    let completionSignal: AbortSignal | undefined;
    const handoffOutcome = vi.fn((
      ...args: [Window, string, AuthorizationOutcome, AbortSignal]
    ) => {
      completionSignal = args[3];
      return new Promise<boolean>((resolve) => {
        completionSignal?.addEventListener("abort", () => resolve(true), { once: true });
      });
    });
    const { controller } = createController({ handoffOutcome });
    const approval = controller.approve(SELECTED_IDENTITY);
    await vi.waitFor(() => expect(handoffOutcome).toHaveBeenCalledOnce());

    controller.dispose();

    await expect(approval).resolves.toMatchObject({ status: "completing" });
    expect(completionSignal?.aborted).toBe(true);
  });

  it("never approves or completes an invalid request", async () => {
    const handoffOutcome = vi.fn(async () => true);
    const { controller } = createController(
      { handoffOutcome },
      { status: "invalid" },
    );

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "invalid" });
    await expect(controller.cancel()).resolves.toEqual({ status: "invalid" });
    expect(MOCKS.approveAuthorization).not.toHaveBeenCalled();
    expect(handoffOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", "manual-entry"],
    ["expired", "invalid"],
  ] as const)("maps an %s entry to %s", (entryStatus, viewStatus) => {
    const { controller } = createController({}, { status: entryStatus });

    expect(controller.getState()).toEqual({ status: viewStatus });
  });

  it("keeps a request live while the user completes onboarding", () => {
    vi.useFakeTimers();
    const { controller, entry } = createController();
    if (entry.status !== "valid") throw new Error("Expected a valid entry");

    vi.advanceTimersByTime(24 * 60 * 60_000);

    expect(controller.getState().status).toBe("review");
    expect(IssuedPubkyAuthRequest.isLive(entry.request)).toBe(true);
    controller.dispose();
  });
});

function createController(
  overrides: Partial<ControllerOverrides> = {},
  entryOptions: EntryOptions = {},
): {
  controller: PassportAuthorizationController;
  entry: AuthorizationEntry;
} {
  if (overrides.handoffOutcome) {
    MOCKS.handoffAuthorizationOutcome.mockImplementation(overrides.handoffOutcome);
  }
  const entry = createEntry(entryOptions);
  return {
    controller: new PassportAuthorizationController(window, entry),
    entry,
  };
}

function createEntry(options: EntryOptions): AuthorizationEntry {
  switch (options.status ?? "valid") {
    case "valid": {
      const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(
        validRequest(options.callbacks),
      ));
      if (Result.isError(issued)) throw new Error(issued.error.code);
      return {
        status: "valid",
        request: issued.value,
      };
    }
    case "invalid":
      return { status: "invalid" };
    case "empty":
      return { status: "empty" };
    case "expired":
      return { status: "expired" };
  }
}

function validRequest(callbacksEnabled = true): string {
  const callbacks = callbacksEnabled === false
    ? ""
    : `&x-success=${encodeURIComponent(SUCCESS_CALLBACK)}&x-error=${encodeURIComponent(ERROR_CALLBACK)}&x-cancel=${encodeURIComponent(CANCEL_CALLBACK)}`;
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}${callbacks}`;
}
