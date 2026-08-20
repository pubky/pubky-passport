/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { LOGGER } from "../../../libs/logger/logger";
import type { AuthorizationEntry } from "./authorizationEntry";
import type { AuthorizationOutcome } from "./completeAuthorizationOutcome";
import { IssuedPubkyAuthRequest } from "./IssuedPubkyAuthRequest";
import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "./PassportAuthorizationController";

const MOCKS = vi.hoisted(() => ({
  approveAuthRequest: vi.fn(),
  completeAuthorizationOutcome: vi.fn(),
  dispose: vi.fn(),
  disposeIdentityKey: vi.fn(),
  PubkySdkAdapter: vi.fn(),
  readIdentity: vi.fn(),
  restoreIdentityKey: vi.fn(),
}));

vi.mock("../pubky/PubkySdkAdapter", () => ({
  PubkySdkAdapter: MOCKS.PubkySdkAdapter,
}));

vi.mock("../local-identity/LocalStorageIdentityRepository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../local-identity/LocalStorageIdentityRepository")>(),
  LocalStorageIdentityRepository: class {
    read = MOCKS.readIdentity;
  },
}));

vi.mock("./completeAuthorizationOutcome", async (importOriginal) => ({
  ...await importOriginal<typeof import("./completeAuthorizationOutcome")>(),
  completeAuthorizationOutcome: MOCKS.completeAuthorizationOutcome,
}));

type ControllerOverrides = {
  completeOutcome: (
    appWindow: Window,
    callback: string,
    outcome: AuthorizationOutcome,
    signal: AbortSignal,
  ) => Promise<boolean>;
  now: () => number;
};

type EntryOptions = {
  callbacks?: boolean;
  expiresAt?: number;
  status?: "valid" | "invalid" | "empty" | "expired";
};

const SUCCESS_CALLBACK = "https://app.example/success?code=private";
const ERROR_CALLBACK = "https://app.example/error?code=private";
const CANCEL_CALLBACK = "https://app.example/cancel?code=private";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const SELECTED_IDENTITY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const PUBLIC_IDENTITY = {
  publicKeyZ32: SELECTED_IDENTITY,
  publicKeyDisplay: `pubky${SELECTED_IDENTITY}`,
};
const OTHER_PUBLIC_IDENTITY = {
  publicKeyZ32: "y".repeat(52),
  publicKeyDisplay: `pubky${"y".repeat(52)}`,
};
const KEY_HANDLE = {};

describe("PassportAuthorizationController", () => {
  beforeEach(() => {
    for (const mock of Object.values(MOCKS)) mock.mockReset();
    MOCKS.PubkySdkAdapter.mockImplementation(function () {
      return {
        approveAuthRequest: MOCKS.approveAuthRequest,
        dispose: MOCKS.dispose,
        disposeIdentityKey: MOCKS.disposeIdentityKey,
        restoreIdentityKey: MOCKS.restoreIdentityKey,
      };
    });
    MOCKS.readIdentity.mockReturnValue(Result.ok({
      identity: { publicIdentity: PUBLIC_IDENTITY },
      secretKey: { bytes: new Uint8Array(32).fill(7), format: "pubky-secret-key" },
    }));
    MOCKS.restoreIdentityKey.mockImplementation(async (secretKey) => {
      secretKey.bytes.fill(0);
      return Result.ok({ keyHandle: KEY_HANDLE, publicIdentity: PUBLIC_IDENTITY });
    });
    MOCKS.approveAuthRequest.mockResolvedValue(Result.ok());
    MOCKS.completeAuthorizationOutcome.mockResolvedValue(true);
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
    MOCKS.approveAuthRequest.mockImplementation((keyHandle, request) => {
      void keyHandle;
      capturedRequest = request;
      return new Promise((resolve) => {
        completeApproval = () => resolve(Result.ok());
      });
    });
    const completeOutcome = vi.fn(async () => true);
    const { controller } = createController({ completeOutcome });

    const first = controller.approve(SELECTED_IDENTITY);
    const second = controller.approve("other-public-key");

    expect(controller.getState().status).toBe("approving");
    await vi.waitFor(() => expect(MOCKS.approveAuthRequest).toHaveBeenCalledOnce());
    expect(MOCKS.readIdentity).toHaveBeenCalledWith(SELECTED_IDENTITY);
    expect(MOCKS.approveAuthRequest).toHaveBeenCalledWith(KEY_HANDLE, capturedRequest);
    completeApproval?.();

    await expect(first).resolves.toMatchObject({ status: "completing" });
    await expect(second).resolves.toMatchObject({ status: "approving" });
    expect(completeOutcome).toHaveBeenCalledWith(
      window,
      SUCCESS_CALLBACK,
      "success",
      expect.anything(),
    );
    expect(IssuedPubkyAuthRequest.isLive(capturedRequest)).toBe(false);
  });

  it("routes approval errors and cancellation through exact validated callbacks", async () => {
    const completeOutcome = vi.fn(async () => true);
    MOCKS.approveAuthRequest.mockResolvedValueOnce(Result.err({ code: "approval_failed" }));
    const failed = createController({ completeOutcome }).controller;
    await failed.approve(SELECTED_IDENTITY);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
    expect(completeOutcome).toHaveBeenLastCalledWith(
      window,
      ERROR_CALLBACK,
      "error",
      expect.anything(),
    );

    const cancelled = createController({ completeOutcome }).controller;
    await cancelled.cancel();
    expect(completeOutcome).toHaveBeenLastCalledWith(
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
      MOCKS.approveAuthRequest.mockResolvedValueOnce(Result.err({ code: "approval_failed" }));
    }
    const { controller } = createController({ completeOutcome: async () => false });

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
    MOCKS.approveAuthRequest.mockResolvedValueOnce(Result.err({ code: "approval_failed" }));
    const { controller } = createController({}, { callbacks: false });

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "failed" });
  });

  it("rejects repository data for a different identity before restoring it", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const secretKey = { bytes: new Uint8Array(32).fill(7), format: "pubky-secret-key" };
    MOCKS.readIdentity.mockReturnValue(Result.ok({
      identity: { publicIdentity: OTHER_PUBLIC_IDENTITY },
      secretKey,
    }));
    const { controller } = createController({}, { callbacks: false });

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "failed" });

    expect(MOCKS.restoreIdentityKey).not.toHaveBeenCalled();
    expect(secretKey.bytes).toEqual(new Uint8Array(32));
  });

  it("disposes a restored key that does not match stored identity metadata", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.restoreIdentityKey.mockImplementationOnce(async (secretKey) => {
      secretKey.bytes.fill(0);
      return Result.ok({ keyHandle: KEY_HANDLE, publicIdentity: OTHER_PUBLIC_IDENTITY });
    });
    const { controller } = createController({}, { callbacks: false });

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "failed" });

    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
    expect(MOCKS.approveAuthRequest).not.toHaveBeenCalled();
  });

  it("makes approval and state listeners exception-total", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.approveAuthRequest.mockRejectedValueOnce(new Error("approval exploded"));
    const { controller } = createController({}, { callbacks: false });
    controller.subscribe(() => { throw new Error("listener exploded"); });

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "failed" });
    await expect(controller.cancel()).resolves.toEqual({ status: "failed" });
    expect(warning).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "sdk_approve",
      code: "unexpected_failure",
    });
  });

  it("releases an abandoned request without completing its callback", async () => {
    let completeApproval: (() => void) | undefined;
    MOCKS.approveAuthRequest.mockImplementationOnce(() =>
      new Promise((resolve) => {
        completeApproval = () => resolve(Result.ok());
      })
    );
    const completeOutcome = vi.fn(async () => true);
    const { controller, entry } = createController({ completeOutcome });
    if (entry.status !== "valid") throw new Error("Expected a valid entry");
    const approval = controller.approve(SELECTED_IDENTITY);
    await vi.waitFor(() => expect(MOCKS.approveAuthRequest).toHaveBeenCalledOnce());

    controller.dispose();
    completeApproval?.();

    await expect(approval).resolves.toEqual({
      status: "approving",
      review: entry.request.review,
    });
    expect(IssuedPubkyAuthRequest.isLive(entry.request)).toBe(false);
    expect(completeOutcome).not.toHaveBeenCalled();
  });

  it("aborts callback completion when the controller is abandoned", async () => {
    let completionSignal: AbortSignal | undefined;
    const completeOutcome = vi.fn((
      ...args: [Window, string, AuthorizationOutcome, AbortSignal]
    ) => {
      completionSignal = args[3];
      return new Promise<boolean>((resolve) => {
        completionSignal?.addEventListener("abort", () => resolve(true), { once: true });
      });
    });
    const { controller } = createController({ completeOutcome });
    const approval = controller.approve(SELECTED_IDENTITY);
    await vi.waitFor(() => expect(completeOutcome).toHaveBeenCalledOnce());

    controller.dispose();

    await expect(approval).resolves.toMatchObject({ status: "completing" });
    expect(completionSignal?.aborted).toBe(true);
  });

  it("never approves or completes an invalid request", async () => {
    const completeOutcome = vi.fn(async () => true);
    const { controller } = createController(
      { completeOutcome },
      { status: "invalid" },
    );

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "invalid" });
    await expect(controller.cancel()).resolves.toEqual({ status: "invalid" });
    expect(MOCKS.PubkySdkAdapter).not.toHaveBeenCalled();
    expect(completeOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", "manual-entry"],
    ["expired", "invalid"],
  ] as const)("maps an %s entry to %s", (entryStatus, viewStatus) => {
    const { controller } = createController({}, { status: entryStatus });

    expect(controller.getState()).toEqual({ status: viewStatus });
  });

  it("expires a request while it is waiting for review", () => {
    vi.useFakeTimers();
    const expiresAt = Date.now() + 1_000;
    const { controller, entry } = createController({}, { expiresAt });
    if (entry.status !== "valid") throw new Error("Expected a valid entry");

    vi.advanceTimersByTime(1_000);

    expect(controller.getState()).toEqual({ status: "invalid" });
    expect(IssuedPubkyAuthRequest.isLive(entry.request)).toBe(false);
  });

  it("checks the deadline when a throttled expiration timer has not run", async () => {
    let now = 0;
    const { controller } = createController(
      { now: () => now },
      { expiresAt: 1_000 },
    );

    now = 1_001;

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "invalid" });
    expect(MOCKS.PubkySdkAdapter).not.toHaveBeenCalled();
  });

  it("does not approve when identity restoration finishes after the deadline", async () => {
    let now = 0;
    let continueRestoration: () => void = () => undefined;
    const restorationGate = new Promise<void>((resolve) => {
      continueRestoration = resolve;
    });
    MOCKS.restoreIdentityKey.mockImplementationOnce(async (secretKey) => {
      await restorationGate;
      secretKey.bytes.fill(0);
      return Result.ok({ keyHandle: KEY_HANDLE, publicIdentity: PUBLIC_IDENTITY });
    });
    const { controller } = createController(
      { now: () => now },
      { callbacks: false, expiresAt: 1_000 },
    );
    const approval = controller.approve(SELECTED_IDENTITY);
    await vi.waitFor(() => expect(MOCKS.restoreIdentityKey).toHaveBeenCalledOnce());

    now = 1_000;
    continueRestoration();

    await expect(approval).resolves.toEqual({ status: "failed" });
    expect(MOCKS.approveAuthRequest).not.toHaveBeenCalled();
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });
});

function createController(
  overrides: Partial<ControllerOverrides> = {},
  entryOptions: EntryOptions = {},
): {
  controller: PassportAuthorizationController;
  entry: AuthorizationEntry;
} {
  if (overrides.completeOutcome) {
    MOCKS.completeAuthorizationOutcome.mockImplementation(overrides.completeOutcome);
  }
  if (overrides.now) vi.spyOn(Date, "now").mockImplementation(overrides.now);

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
        expiresAt: options.expiresAt ?? Date.now() + 60_000,
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
