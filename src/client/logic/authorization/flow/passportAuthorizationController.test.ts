/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { requestDigest } from "@/libs/requestDigest";
import { LOGGER } from "@/libs/logger/logger";
import type { AuthorizationEntry } from "@/client/logic/authorization/entry/authorizationEntry";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { OpenerChannel } from "../opener/OpenerChannel";
import type * as AuthorizationHandoff from "./authorizationOutcomeHandoff";
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
  ...(await importOriginal<typeof AuthorizationHandoff>()),
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
  /** `profile=required` next to `d=`. */
  profile?: "required";
};

const SUCCESS_CALLBACK = "https://app.example/success?code=private";
const ERROR_CALLBACK = "https://app.example/error?code=private";
const CANCEL_CALLBACK = "https://app.example/cancel?code=private";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const SELECTED_IDENTITY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const openerChannels: OpenerChannel[] = [];

describe("PassportAuthorizationController", () => {
  beforeEach(() => {
    for (const mock of Object.values(MOCKS)) mock.mockReset();
    MOCKS.approveAuthorization.mockResolvedValue(Result.ok());
    MOCKS.handoffAuthorizationOutcome.mockResolvedValue("navigated");
  });

  afterEach(() => {
    for (const channel of openerChannels.splice(0)) channel.dispose();
    PassportAuthorizationController.fromBrowser(() => undefined).dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("hands the success callback back after an external signer with a live v1 opener", async () => {
    vi.stubGlobal("opener", { closed: false });
    const handoffOutcome = vi.fn(async () => "acknowledged-and-closed" as const);
    const { controller, entry } = createController({ handoffOutcome });
    if (entry.status !== "valid") throw new Error("Expected a valid entry");

    seeRingAnswer(controller);
    await vi.waitFor(() => expect(controller.getState().status).toBe("completing"));

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
    // The request has ended: there is nothing left to watch or hand back.
    expect(controller.canWatchExternalApproval()).toBe(false);
    seeRingAnswer(controller);
    expect(controller.getState().status).toBe("completing");
    expect(handoffOutcome).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    "an unbound live opener gets one v1 Ring hint and ack=%s",
    async (acknowledged) => {
      vi.useFakeTimers();
      const actual = await vi.importActual<typeof AuthorizationHandoff>(
        "./authorizationOutcomeHandoff",
      );
      MOCKS.handoffAuthorizationOutcome.mockImplementation(actual.handoffAuthorizationOutcome);
      const f = createOpenerController(false, true);
      seeRingAnswer(f.controller);
      await vi.waitFor(() => expect(f.opener.postMessage).toHaveBeenCalled());
      expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
        {
          type: "pubky-passport.authorization-outcome",
          version: 1,
          outcome: "success",
          messageId: "outcome-id",
        },
        "https://app.example",
      );
      if (acknowledged) f.legacyAck();
      else await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(f.controller.getState().status).toBe("completing"));
      await vi.advanceTimersByTimeAsync(0);
      expect(f.appWindow.close).toHaveBeenCalledTimes(acknowledged ? 1 : 0);
      if (acknowledged) expect(f.appWindow.location.replace).not.toHaveBeenCalled();
      else expect(f.appWindow.location.replace).toHaveBeenCalledExactlyOnceWith(SUCCESS_CALLBACK);
      expect(f.opener.postMessage).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("never reports an external signer's request as approved without a callback", async () => {
    vi.stubGlobal("opener", { closed: false });
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const handoffOutcome = vi.fn(async () => "unavailable" as const);
    const withoutCallbacks = createController({ handoffOutcome }, { callbacks: false }).controller;
    seeRingAnswer(withoutCallbacks);
    await vi.waitFor(() =>
      expect(withoutCallbacks.getState()).toEqual({
        status: "handed-off",
        review: expect.any(Object),
      }),
    );
    expect(handoffOutcome).not.toHaveBeenCalled();

    const unreachable = createController({ handoffOutcome }).controller;
    seeRingAnswer(unreachable);
    await vi.waitFor(() =>
      expect(unreachable.getState()).toEqual({
        status: "handed-off",
        review: expect.any(Object),
      }),
    );
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

  it("without callbacks, a posted answer in this tab ends the request on Passport's home", async () => {
    const { controller } = createController({}, { callbacks: false });
    const { scheduled, watch } = fakeAppRelay(["false"]);

    watch(controller);
    scheduled.shift()?.();
    await vi.waitFor(() => expect(controller.getState().status).toBe("handed-off"));
    // Only what Passport saw, never a claim: no approval, and nothing more about it.
    expect(controller.getState()).toEqual({ status: "handed-off", review: expect.any(Object) });
    expect(MOCKS.approveAuthorization).not.toHaveBeenCalled();
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

  it("returns directly after a seen v2 Ring answer once the bound opener has gone", async () => {
    const f = createOpenerController(true, true);
    f.opener.closed = true;
    seeRingAnswer(f.controller);
    await vi.waitFor(() => expect(f.controller.getState()).toMatchObject({ status: "completing" }));
    expect(f.appWindow.location.replace).toHaveBeenCalledExactlyOnceWith(SUCCESS_CALLBACK);
    expect(f.entry.status === "valid" && f.entry.request.isLive()).toBe(false);
    expect(MOCKS.handoffAuthorizationOutcome).not.toHaveBeenCalled();
    expect(MOCKS.approveAuthorization).not.toHaveBeenCalled();
    expect(f.appWindow.close).not.toHaveBeenCalled();
    seeRingAnswer(f.controller);
    expect(f.appWindow.location.replace).toHaveBeenCalledOnce();
  });

  it("ends a v2 Ring hand-off on Passport's home when its direct return is unavailable", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const f = createOpenerController(true, true);
    f.opener.closed = true;
    f.appWindow.location.replace.mockImplementation(() => {
      throw new Error(SECRET);
    });
    seeRingAnswer(f.controller);
    await vi.waitFor(() => expect(f.controller.getState()).toMatchObject({ status: "handed-off" }));
    expect(MOCKS.handoffAuthorizationOutcome).not.toHaveBeenCalled();
    expect(JSON.stringify(f.controller.getState())).not.toContain(SECRET);
  });

  it("abandoning a v2 direct Ring return before navigation suppresses it", async () => {
    const f = createOpenerController(true, true);
    f.opener.closed = true;
    const disposed = vi.fn();
    f.controller.subscribe(() => {
      f.controller.dispose();
      disposed();
    });
    seeRingAnswer(f.controller);
    await vi.waitFor(() => expect(disposed).toHaveBeenCalled());
    expect(f.appWindow.location.replace).not.toHaveBeenCalled();
  });

  it("hands a seen Ring answer without a hello to the v1 callback hand-off", async () => {
    const { controller } = createController();
    seeRingAnswer(controller);
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ status: "completing" }));
    expect(MOCKS.handoffAuthorizationOutcome).toHaveBeenCalledWith(
      window,
      SUCCESS_CALLBACK,
      "success",
      expect.anything(),
    );
  });

  it.each(["empty", "invalid", "expired"] as const)("never reports a phase for %s", (status) => {
    const f = createOpenerController();
    const controller = new PassportAuthorizationController(
      f.appWindow as unknown as Window,
      createEntry({ status }),
      f.channel,
    );
    controller.reportPhase("ring");
    controller.reportPhase("granting");
    expect(f.opener.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["approval_failed", "delivery"],
    ["identity_unavailable", "identity"],
    ["storage_unavailable", "identity"],
    ["relay_unreachable", "delivery"],
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

  it("retires before the first hello, then replies completed without replaying an outcome", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const f = createOpenerController(false);
    const states: PassportAuthorizationViewState[] = [];
    f.controller.subscribe((state) => states.push(state));
    expect(await f.controller.cancel()).toMatchObject({ status: "cancelled" });
    expect(states).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(warn).not.toHaveBeenCalled();
    expect(f.entry.status === "valid" && f.entry.request.isLive()).toBe(false);
    f.hello();
    f.hello();
    expect(f.opener.postMessage).toHaveBeenCalledTimes(2);
    for (const [message] of f.opener.postMessage.mock.calls)
      expect(message).toMatchObject({
        type: "pubky-passport.ready",
        request: { status: "completed" },
      });
    expect(MOCKS.handoffAuthorizationOutcome).not.toHaveBeenCalled();
  });

  it("logs a callback-free ack timeout as an opener failure only", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const f = createOpenerController();
    const pending = f.controller.cancel();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    expect(warn).toHaveBeenCalledExactlyOnceWith("authorize.opener_handoff.failed", {
      operation: "acknowledge",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "a seen Ring answer reports Ring then retires v2 without an outcome, with callbacks=%s",
    async (callbacks) => {
      const f = createOpenerController(true, callbacks);
      seeRingAnswer(f.controller);
      await vi.waitFor(() =>
        expect(f.controller.getState()).toMatchObject({ status: "handed-off" }),
      );
      expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
        { type: "pubky-passport.status", version: 2, attemptId: "0123456789abcdef", phase: "ring" },
        "https://verified.example",
      );
      expect(f.appWindow.close).not.toHaveBeenCalled();
      expect(f.appWindow.location.replace).not.toHaveBeenCalled();
      expect(f.entry.status === "valid" && f.entry.request.isLive()).toBe(false);
      expect(f.controller.externalSignerUrl()).toBeUndefined();
      f.controller.reportPhase("ring");
      f.channel.post({ type: "pubky-passport.status", phase: "ring" });
      expect(f.opener.postMessage).toHaveBeenCalledOnce();
      f.hello();
      expect(f.opener.postMessage.mock.lastCall).toEqual([
        expect.objectContaining({ type: "pubky-passport.ready", request: { status: "completed" } }),
        "https://verified.example",
      ]);
      expect(MOCKS.approveAuthorization).not.toHaveBeenCalled();
      expect(MOCKS.handoffAuthorizationOutcome).not.toHaveBeenCalled();
    },
  );

  it("sends ready before Ring when a hello first binds during the Ring view", async () => {
    const f = createOpenerController(false);
    f.controller.reportPhase("ring");
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    f.hello();
    expect(f.opener.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
      "pubky-passport.ready",
      "pubky-passport.status",
    ]);
    expect(f.opener.postMessage.mock.calls[0]?.[0].request).toEqual({ status: "valid" });
    expect(f.opener.postMessage.mock.calls[1]?.[0]).toEqual({
      type: "pubky-passport.status",
      version: 2,
      attemptId: "0123456789abcdef",
      phase: "ring",
    });
    f.opener.postMessage.mockClear();
    f.hello();
    expect(f.opener.postMessage.mock.calls.map(([m]) => m.type)).toEqual(["pubky-passport.ready"]);
    seeRingAnswer(f.controller);
    await vi.waitFor(() => expect(f.controller.getState().status).toBe("handed-off"));
    expect(f.opener.postMessage.mock.lastCall?.[0].phase).toBe("ring");
    expect(
      f.opener.postMessage.mock.calls.some(
        ([m]) => m.type === "pubky-passport.authorization-outcome",
      ),
    ).toBe(false);
  });

  it.each(["before-ring", "left-ring", "disposed"])("binding reports no phase when %s", (mode) => {
    const f = createOpenerController(false);
    if (mode !== "before-ring") f.controller.reportPhase("ring");
    if (mode === "left-ring") f.controller.leaveExternalSigner();
    if (mode === "disposed") f.controller.dispose();
    f.hello();
    expect(f.opener.postMessage.mock.calls.map(([m]) => m.type)).toEqual(["pubky-passport.ready"]);
  });

  it("a first hello after a seen Ring answer receives only completed", async () => {
    const f = createOpenerController(false);
    f.controller.reportPhase("ring");
    seeRingAnswer(f.controller);
    await vi.waitFor(() => expect(f.controller.getState().status).toBe("handed-off"));
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    f.hello();
    expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "pubky-passport.ready", request: { status: "completed" } }),
      "https://verified.example",
    );
  });

  it.each(["approve", "cancel"] as const)(
    "posts %s before any completed ready while awaiting ack",
    async (action) => {
      const f = createOpenerController();
      const pending =
        action === "approve" ? f.controller.approve(SELECTED_IDENTITY) : f.controller.cancel();
      queueMicrotask(f.hello);
      await vi.waitFor(() => expect(f.opener.postMessage).toHaveBeenCalledTimes(2));
      expect(f.opener.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
        "pubky-passport.authorization-outcome",
        "pubky-passport.ready",
      ]);
      expect(f.opener.postMessage.mock.calls[1]?.[0].request).toEqual({ status: "completed" });
      f.ack();
      await pending;
    },
  );

  it("reports granting only at the irreversible approval commit", async () => {
    const f = createOpenerController();
    let commit!: () => void;
    let finish!: () => void;
    MOCKS.approveAuthorization.mockImplementation((_request, _key, _signal, onCommit) => {
      commit = onCommit;
      return new Promise((resolve) => {
        finish = () => resolve(Result.ok());
      });
    });
    const pending = f.controller.approve(SELECTED_IDENTITY);
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    f.controller.reportPhase("ring");
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    commit();
    expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: "pubky-passport.status",
        version: 2,
        attemptId: "0123456789abcdef",
        phase: "granting",
      },
      "https://verified.example",
    );
    finish();
    await vi.waitFor(() => expect(f.opener.postMessage).toHaveBeenCalledTimes(2));
    f.ack();
    await pending;
  });

  it("retains completed when posting the terminal outcome throws", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const f = createOpenerController();
    f.opener.postMessage.mockImplementationOnce(() => {
      throw new Error(SECRET);
    });
    expect(await f.controller.cancel()).toMatchObject({ status: "cancelled" });
    f.hello();
    expect(f.opener.postMessage.mock.lastCall?.[0]).toMatchObject({
      type: "pubky-passport.ready",
      request: { status: "completed" },
    });
    expect(f.entry.status === "valid" && f.entry.request.isLive()).toBe(false);
  });

  it("routes a callback-free error through v2 using only its stable reason", async () => {
    const f = createOpenerController();
    MOCKS.approveAuthorization.mockResolvedValueOnce(
      Result.err({ code: "storage_unavailable", cause: new Error(SECRET) }),
    );
    const pending = f.controller.approve(SELECTED_IDENTITY);
    await vi.waitFor(() =>
      expect(f.opener.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pubky-passport.authorization-outcome",
          outcome: "error",
          code: "storage_unavailable",
        }),
        "https://verified.example",
      ),
    );
    f.ack();
    await pending;
    expect(f.appWindow.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.opener.postMessage.mock.calls)).not.toContain(SECRET);
    expect(MOCKS.handoffAuthorizationOutcome).not.toHaveBeenCalled();
  });

  it("abandoning a v2 handoff cancels its acknowledgment wait", async () => {
    vi.useFakeTimers();
    const f = createOpenerController();
    const pending = f.controller.cancel();
    f.controller.dispose();
    await pending;
    expect(f.appWindow.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the app's profile requirement", () => {
  it("is off unless the app asks", () => {
    const { controller } = createController();
    expect(controller.getState()).toEqual({ status: "review", review: expect.anything() });
    expect(
      createOpenerController(true, false, "optional").controller.getState(),
    ).not.toHaveProperty("profileRequired");
  });

  it("comes from profile=required next to d= (a same-tab request)", () => {
    const { controller } = createController({}, { profile: "required" });
    expect(controller.getState()).toMatchObject({ status: "review", profileRequired: true });
  });

  it("comes from the hello that bound this request (a pop-up)", () => {
    const f = createOpenerController(true, false, "required");
    expect(f.controller.getState()).toMatchObject({ status: "review", profileRequired: true });
  });

  it("arrives with a hello that binds after the review was shown", () => {
    const f = createOpenerController(false);
    const states: unknown[] = [];
    f.controller.subscribe((state) => states.push(state));
    expect(f.controller.getState()).not.toHaveProperty("profileRequired");
    f.hello("required");
    expect(f.controller.getState()).toMatchObject({ status: "review", profileRequired: true });
    expect(states).toHaveLength(1);
    // Later hellos cannot add it twice or take it back.
    f.hello("optional");
    expect(states).toHaveLength(1);
  });
});

describe("a profile the app waits for after a Pubky Ring sign-in", () => {
  const RING_KEY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
  const ask = (f: ReturnType<typeof createOpenerController>) =>
    f.send({
      type: "pubky-passport.profile-needed",
      version: 2,
      attemptId: "0123456789abcdef",
      publicKey: RING_KEY,
    });

  it("counts only once this request went to Pubky Ring", () => {
    const f = createOpenerController();
    const states: unknown[] = [];
    f.controller.subscribe((state) => states.push(state));
    ask(f);
    expect(f.controller.profileNeeded()).toBeUndefined();
    expect(states).toEqual([]);
    const g = createOpenerController();
    g.controller.subscribe((state) => states.push(state));
    g.controller.reportPhase("ring");
    ask(g);
    expect(g.controller.profileNeeded()).toBe(RING_KEY);
    // Taking it retires the request: Ring answered the app.
    expect(states.at(-1)).toMatchObject({ status: "handed-off" });
  });

  it("ignores a message that comes while the request is not with Ring, without blocking a later one", () => {
    const f = createOpenerController();
    // Too early: the review is on screen. Ignored, and forgotten, not latched.
    ask(f);
    expect(f.controller.profileNeeded()).toBeUndefined();
    f.controller.reportPhase("ring");
    ask(f);
    expect(f.controller.profileNeeded()).toBe(RING_KEY);
    // Back from the Ring screen, a later message changes nothing either.
    const g = createOpenerController();
    g.controller.reportPhase("ring");
    g.controller.leaveExternalSigner();
    ask(g);
    expect(g.controller.profileNeeded()).toBeUndefined();
  });

  it("retires the request when it takes the app's ask: Ring has answered the app", () => {
    const f = createOpenerController();
    f.controller.reportPhase("ring");
    f.opener.postMessage.mockClear();
    ask(f);
    expect(f.controller.getState()).toMatchObject({ status: "handed-off" });
    expect(f.controller.externalSignerUrl()).toBeUndefined();
    // A later hello learns that the request ended, and gets no outcome.
    f.hello();
    expect(f.opener.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "pubky-passport.ready", request: { status: "completed" } }),
      "https://verified.example",
    );
  });

  it("answers the app with profile-ready once its profile is published", () => {
    const f = createOpenerController();
    f.controller.reportPhase("ring");
    ask(f);
    f.opener.postMessage.mockClear();
    expect(f.controller.profileReady()).toBe(true);
    expect(f.opener.postMessage).toHaveBeenCalledWith(
      { type: "pubky-passport.profile-ready", version: 2, attemptId: "0123456789abcdef" },
      "https://verified.example",
    );
  });

  it("takes the key of a /#profile= page, which a request never has", () => {
    const controller = new PassportAuthorizationController(
      window,
      { status: "empty" },
      undefined,
      RING_KEY,
    );
    expect(controller.profileNeeded()).toBe(RING_KEY);
    expect(controller.profileReady()).toBe(false);
    controller.dispose();
    expect(controller.profileNeeded()).toBeUndefined();
  });
});

function createOpenerController(
  bound = true,
  callbacks = false,
  profile?: "required" | "optional",
) {
  const target = new EventTarget();
  const opener = { postMessage: vi.fn(), closed: false };
  const appWindow = {
    opener,
    closed: false,
    close: vi.fn(() => {
      appWindow.closed = true;
    }),
    crypto: { randomUUID: () => "outcome-id" },
    location: { replace: vi.fn() },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };
  const entry = createEntry({ callbacks });
  const digest =
    entry.status === "valid" ? requestDigest(entry.request.validatedUrlForApproval()!) : "";
  const channel = OpenerChannel.create(appWindow as unknown as Window, entry)!;
  openerChannels.push(channel);
  const send = (data: unknown, origin = "https://verified.example") =>
    target.dispatchEvent(
      Object.assign(new Event("message"), {
        origin,
        source: opener,
        data,
      }),
    );
  const hello = (profile?: "required" | "optional") =>
    send({
      type: "pubky-passport.hello",
      version: 2,
      attemptId: "0123456789abcdef",
      features: [],
      ...(profile ? { profile } : {}),
      // A40: the digest of the request the controller holds.
      request: digest,
    });
  if (bound) hello(profile);
  opener.postMessage.mockClear();
  return {
    entry,
    channel,
    appWindow,
    opener,
    hello,
    send,
    controller: new PassportAuthorizationController(appWindow as unknown as Window, entry, channel),
    legacyAck: () =>
      send(
        { type: "pubky-passport.authorization-outcome-ack", version: 1, messageId: "outcome-id" },
        "https://app.example",
      ),
    ack: () =>
      send({
        type: "pubky-passport.authorization-outcome-ack",
        version: 2,
        attemptId: "0123456789abcdef",
        messageId: "outcome-id",
      }),
  };
}

/**
 * A fake of the app's relay answering each `/ack` look with the next of `replies` (`404`, `false`
 * or `true`), with a page always in view and looks run by hand from `scheduled`.
 */
/** Ends a Ring hand-off the only way there is: Passport's watch sees the app take Ring's answer. */
function seeRingAnswer(controller: PassportAuthorizationController): void {
  const { scheduled, watch } = fakeAppRelay(["true"]);
  watch(controller);
  scheduled.shift()?.();
}

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
        ...(options.profile ? { profile: options.profile } : {}),
      };
    }
    case "invalid":
      return { status: "invalid", code: "invalid_fragment_shape" };
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
