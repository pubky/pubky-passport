/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import type { AuthorizationEntry } from "@/client/logic/authorization/entry/authorizationEntry";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type {
  AuthorizationHandoffStatus,
  AuthorizationOutcome,
} from "./authorizationOutcomeHandoff";
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
  ...(await importOriginal<typeof import("./authorizationOutcomeHandoff")>()),
  handoffAuthorizationOutcome: MOCKS.handoffAuthorizationOutcome,
}));

type ControllerOverrides = {
  handoffOutcome: (
    appWindow: Window,
    callback: string,
    outcome: AuthorizationOutcome,
    signal: AbortSignal,
  ) => Promise<AuthorizationHandoffStatus>;
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
    MOCKS.handoffAuthorizationOutcome.mockResolvedValue("navigated");
  });

  afterEach(() => {
    PassportAuthorizationController.fromBrowser(() => undefined).dispose();
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

  it("exposes the exact live request only for an external signer handoff", async () => {
    const { controller } = createController();

    expect(controller.externalSignerUrl()).toBe(validRequest());

    await controller.cancel();
    expect(controller.externalSignerUrl()).toBeUndefined();
  });

  it("approves once with the reviewed identity and completes the success callback", async () => {
    let completeApproval: (() => void) | undefined;
    let capturedRequest: ValidatedPubkyAuthRequest | undefined;
    MOCKS.approveAuthorization.mockImplementation((request, _publicKey, _signal, onCommit) => {
      capturedRequest = request;
      onCommit();
      return new Promise((resolve) => {
        completeApproval = () => resolve(Result.ok());
      });
    });
    const handoffOutcome = vi.fn(async () => "navigated" as const);
    const { controller } = createController({ handoffOutcome });

    const first = controller.approve(SELECTED_IDENTITY);
    const second = controller.approve("other-public-key");

    expect(controller.getState().status).toBe("granting");
    await vi.waitFor(() => expect(MOCKS.approveAuthorization).toHaveBeenCalledOnce());
    expect(MOCKS.approveAuthorization).toHaveBeenCalledWith(
      capturedRequest,
      SELECTED_IDENTITY,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    completeApproval?.();

    await expect(first).resolves.toMatchObject({ status: "completing", outcome: "success" });
    await expect(second).resolves.toMatchObject({ status: "granting" });
    expect(handoffOutcome).toHaveBeenCalledWith(
      window,
      SUCCESS_CALLBACK,
      "success",
      expect.anything(),
    );
    expect(capturedRequest?.isLive()).toBe(false);
  });

  it("routes approval errors and cancellation through exact validated callbacks", async () => {
    const handoffOutcome = vi.fn(async () => "navigated" as const);
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
    // While the answer goes back, the state says it is a refusal, never an approval.
    await expect(cancelled.cancel()).resolves.toMatchObject({
      status: "completing",
      outcome: "cancel",
    });
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
  ] as const)(
    "falls back to a local %s outcome when callback completion fails",
    async (outcome, approvalFails, status, intent) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      if (approvalFails) {
        MOCKS.approveAuthorization.mockResolvedValueOnce(Result.err({ code: "approval_failed" }));
      }
      const { controller } = createController({ handoffOutcome: async () => "unavailable" });

      const state =
        intent === "approve"
          ? await controller.approve(SELECTED_IDENTITY)
          : await controller.cancel();

      expect(state.status).toBe(status);
      expect(warning).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith("authorize.callback.failed", {
        outcome,
        operation: "complete",
      });
    },
  );

  it("hands the success callback back after an external signer, as a hint without approving", async () => {
    const handoffOutcome = vi.fn(async () => "acknowledged-and-closed" as const);
    const { controller, entry } = createController({ handoffOutcome });
    if (entry.status !== "valid") throw new Error("Expected a valid entry");

    await expect(controller.finishExternalApproval()).resolves.toMatchObject({
      status: "completing",
    });

    expect(handoffOutcome).toHaveBeenCalledOnce();
    expect(handoffOutcome).toHaveBeenCalledWith(
      window,
      SUCCESS_CALLBACK,
      "success",
      expect.anything(),
    );
    expect(MOCKS.approveAuthorization).not.toHaveBeenCalled();
    expect(entry.request.isLive()).toBe(false);
    expect(controller.externalSignerUrl()).toBeUndefined();
    await expect(controller.finishExternalApproval()).resolves.toMatchObject({
      status: "completing",
    });
    expect(handoffOutcome).toHaveBeenCalledOnce();
  });

  it("never reports an external signer's request as approved without a callback", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const handoffOutcome = vi.fn(async () => "unavailable" as const);
    const withoutCallbacks = createController({ handoffOutcome }, { callbacks: false }).controller;
    await expect(withoutCallbacks.finishExternalApproval()).resolves.toEqual({
      status: "handed-off",
      review: expect.any(Object),
    });
    expect(handoffOutcome).not.toHaveBeenCalled();

    const unreachable = createController({ handoffOutcome }).controller;
    await expect(unreachable.finishExternalApproval()).resolves.toEqual({
      status: "handed-off",
      review: expect.any(Object),
    });
    expect(warning).toHaveBeenCalledWith("authorize.callback.failed", {
      outcome: "success",
      operation: "complete",
    });
    expect(MOCKS.approveAuthorization).not.toHaveBeenCalled();
  });

  it("in the app's popup, hands the success callback back only once the app took Ring's answer", async () => {
    Object.defineProperty(window, "opener", { configurable: true, value: { closed: false } });
    try {
      const handoffOutcome = vi.fn(async () => "acknowledged-and-closed" as const);
      const { controller } = createController({ handoffOutcome });
      const { relay, scheduled, watch } = fakeAppRelay(["404", "false", "true"]);

      expect(controller.canWatchExternalApproval()).toBe(true);
      watch(controller);
      for (let look = 0; look < 2; look++) {
        scheduled.shift()?.();
        await vi.waitFor(() => expect(scheduled).toHaveLength(1));
        // Nothing posted, then Ring's answer not yet taken by the app: Passport keeps waiting.
        expect(controller.getState().status).toBe("review");
      }
      scheduled.shift()?.();
      await vi.waitFor(() => expect(handoffOutcome).toHaveBeenCalledOnce());
      expect(handoffOutcome).toHaveBeenCalledWith(
        window,
        SUCCESS_CALLBACK,
        "success",
        expect.anything(),
      );
      // Only the acknowledgement was read, never the answer itself, and nothing more is scheduled.
      expect(relay).toHaveBeenCalledTimes(3);
      for (const [url, init] of relay.mock.calls) {
        expect(url).toMatch(/^https:\/\/relay\.example\/inbox\/[\w-]{43}\/ack$/u);
        expect(init.method).toBe("GET");
      }
      expect(scheduled).toEqual([]);
    } finally {
      Object.defineProperty(window, "opener", { configurable: true, value: null });
    }
  });

  it("in the same tab, goes back to the app once Ring's answer waits for it there", async () => {
    const handoffOutcome = vi.fn(async () => "navigated" as const);
    const { controller } = createController({ handoffOutcome });
    const { relay, scheduled, watch } = fakeAppRelay(["404", "false"]);

    watch(controller);
    scheduled.shift()?.();
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));
    expect(controller.getState().status).toBe("review");
    // The app can take the answer only once Passport navigates back to it: posted is enough.
    scheduled.shift()?.();
    await vi.waitFor(() => expect(handoffOutcome).toHaveBeenCalledOnce());
    expect(handoffOutcome).toHaveBeenCalledWith(
      window,
      SUCCESS_CALLBACK,
      "success",
      expect.anything(),
    );
    expect(relay).toHaveBeenCalledTimes(2);
    expect(scheduled).toEqual([]);
  });

  it("records what it saw when a request without callbacks ends as handed off", async () => {
    const { controller } = createController({}, { callbacks: false });
    const { scheduled, watch } = fakeAppRelay(["false"]);

    watch(controller);
    scheduled.shift()?.();
    await vi.waitFor(() => expect(controller.getState().status).toBe("handed-off"));
    expect(controller.getState()).toMatchObject({ status: "handed-off", observed: "posted" });
  });

  it("records nothing seen when the person reports the approval", async () => {
    const { controller } = createController({}, { callbacks: false });

    await controller.finishExternalApproval();
    const state = controller.getState();
    expect(state.status).toBe("handed-off");
    expect(state).not.toHaveProperty("observed");
  });

  it("stops watching once the review ends another way", async () => {
    const { controller } = createController({}, { callbacks: false });
    const cancelTimer = vi.fn();
    const relay = vi.fn();
    controller.watchExternalApproval({
      fetch: relay,
      page: { isVisible: () => true, subscribe: () => () => undefined },
      schedule: () => cancelTimer,
    });

    await controller.cancel();
    expect(cancelTimer).toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
    expect(controller.canWatchExternalApproval()).toBe(false);
  });

  it("offers no watch on a relay without a read-only look", () => {
    const entry = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/link&secret=${SECRET}`,
      ),
    );
    if (Result.isError(entry)) throw new Error(entry.error.code);
    const controller = new PassportAuthorizationController(window, {
      status: "valid",
      request: entry.value,
    });
    const schedule = vi.fn();

    expect(controller.canWatchExternalApproval()).toBe(false);
    controller.watchExternalApproval({ schedule })();
    expect(schedule).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("ignores an external approval report once the request has ended", async () => {
    const handoffOutcome = vi.fn(async () => "navigated" as const);
    const { controller } = createController({ handoffOutcome }, { callbacks: false });
    await controller.cancel();

    await expect(controller.finishExternalApproval()).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(handoffOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ["approval_failed", "delivery"],
    ["identity_unavailable", "identity"],
  ] as const)(
    "tells a %s failure apart as a %s failure, without exposing its cause",
    async (code, reason) => {
      MOCKS.approveAuthorization.mockResolvedValueOnce(
        Result.err({
          code,
          cause: new Error(SECRET),
        }),
      );
      const { controller, entry } = createController({}, { callbacks: false });
      if (entry.status !== "valid") throw new Error("Expected a valid entry");

      const state = await controller.approve(SELECTED_IDENTITY);

      // The review stays, so the outcome can name the app; the cause never reaches the view.
      expect(state).toEqual({ status: "failed", reason, review: entry.request.review });
      expect(JSON.stringify(state)).not.toContain(SECRET);
      expect(state).not.toHaveProperty("cause");
    },
  );

  it("contains handoff exceptions without exposing them to view state", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const handoffError = new TypeError(`handoff failed ${SECRET} ${SUCCESS_CALLBACK}`);
    const { controller } = createController({
      handoffOutcome: async () => {
        throw handoffError;
      },
    });

    const state = await controller.approve(SELECTED_IDENTITY);

    expect(state).toMatchObject({ status: "approved" });
    expect(state).not.toHaveProperty("cause");
    expect(warning).toHaveBeenCalledWith("authorize.callback.failed", {
      outcome: "success",
      operation: "complete",
      diagnosticId: expect.any(String),
      errorName: "TypeError",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SUCCESS_CALLBACK);
  });

  it("makes state listeners exception-total", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller } = createController({}, { callbacks: false });
    controller.subscribe(() => {
      throw new Error("listener exploded");
    });

    await expect(controller.cancel()).resolves.toMatchObject({ status: "cancelled" });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.state_listener.failed", {
      state: "cancelled",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
  });

  it("releases an abandoned request without completing its callback", async () => {
    let completeApproval: (() => void) | undefined;
    MOCKS.approveAuthorization.mockImplementationOnce((_request, _publicKey, _signal, onCommit) => {
      onCommit();
      return new Promise((resolve) => {
        completeApproval = () => resolve(Result.ok());
      });
    });
    const handoffOutcome = vi.fn(async () => "navigated" as const);
    const { controller, entry } = createController({ handoffOutcome });
    if (entry.status !== "valid") throw new Error("Expected a valid entry");
    const approval = controller.approve(SELECTED_IDENTITY);
    await vi.waitFor(() => expect(MOCKS.approveAuthorization).toHaveBeenCalledOnce());

    controller.dispose();
    completeApproval?.();

    await expect(approval).resolves.toEqual({
      status: "granting",
      review: entry.request.review,
    });
    expect(entry.request.isLive()).toBe(false);
    expect(handoffOutcome).not.toHaveBeenCalled();
  });

  it("aborts callback completion when the controller is abandoned", async () => {
    let completionSignal: AbortSignal | undefined;
    const handoffOutcome = vi.fn((...args: [Window, string, AuthorizationOutcome, AbortSignal]) => {
      completionSignal = args[3];
      return new Promise<AuthorizationHandoffStatus>((resolve) => {
        completionSignal?.addEventListener("abort", () => resolve("aborted"), { once: true });
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
    const handoffOutcome = vi.fn(async () => "navigated" as const);
    const { controller } = createController({ handoffOutcome }, { status: "invalid" });

    await expect(controller.approve(SELECTED_IDENTITY)).resolves.toEqual({ status: "invalid" });
    await expect(controller.cancel()).resolves.toEqual({ status: "invalid" });
    expect(MOCKS.approveAuthorization).not.toHaveBeenCalled();
    expect(handoffOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", "manual-entry"],
    ["expired", "expired"],
    ["invalid", "invalid"],
  ] as const)("maps an %s entry to %s", (entryStatus, viewStatus) => {
    const { controller } = createController({}, { status: entryStatus });

    expect(controller.getState()).toEqual({ status: viewStatus });
  });

  it("owns the injected bootstrap entry without reading the address bar", () => {
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const entry = createEntry({});
    const takeInitial = vi.fn(() => entry);

    const fromBrowser = PassportAuthorizationController.fromBrowser(takeInitial);

    expect(fromBrowser).toBe(PassportAuthorizationController.fromBrowser(takeInitial));
    expect(fromBrowser.getState().status).toBe("review");
    expect(takeInitial).toHaveBeenCalledOnce();
    expect(window.location.hash).toContain("d=");
    fromBrowser.dispose();
  });

  it("starts in manual entry when bootstrap capture is absent", () => {
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);

    const controller = PassportAuthorizationController.fromBrowser(() => undefined);

    expect(controller.getState()).toEqual({ status: "manual-entry" });
    expect(window.location.hash).toContain("d=");
    controller.dispose();
  });

  it("keeps a request live while the user completes onboarding", () => {
    vi.useFakeTimers();
    const { controller, entry } = createController();
    if (entry.status !== "valid") throw new Error("Expected a valid entry");

    vi.advanceTimersByTime(24 * 60 * 60_000);

    expect(controller.getState().status).toBe("review");
    expect(entry.request.isLive()).toBe(true);
    controller.dispose();
  });
});

/**
 * A fake of the app's relay answering each `/ack` look with the next of `replies` (`404`, `false`
 * or `true`), with a page always in view and looks run by hand from `scheduled`.
 */
function fakeAppRelay(replies: string[]) {
  const relay = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    const reply = replies.shift() ?? "404";
    return reply === "404"
      ? new Response("Not found", { status: 404 })
      : new Response(reply, { status: 200 });
  });
  const scheduled: (() => void)[] = [];
  const watch = (controller: PassportAuthorizationController) =>
    controller.watchExternalApproval({
      fetch: relay,
      page: { isVisible: () => true, subscribe: () => () => undefined },
      schedule: (run) => {
        scheduled.push(run);
        return () => undefined;
      },
    });
  return { relay, scheduled, watch };
}

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
      const validated = ValidatedPubkyAuthRequest.fromEncoded(
        encodeURIComponent(validRequest(options.callbacks)),
      );
      if (Result.isError(validated)) throw new Error(validated.error.code);
      return {
        status: "valid",
        request: validated.value,
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
  const callbacks =
    callbacksEnabled === false
      ? ""
      : `&x-success=${encodeURIComponent(SUCCESS_CALLBACK)}&x-error=${encodeURIComponent(ERROR_CALLBACK)}&x-cancel=${encodeURIComponent(CANCEL_CALLBACK)}`;
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}${callbacks}`;
}
