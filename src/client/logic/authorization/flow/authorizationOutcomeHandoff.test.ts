import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import { handoffAuthorizationOutcome } from "./authorizationOutcomeHandoff";

const CALLBACK = "https://app.example/auth/passport/success?private=value";

describe("handoffAuthorizationOutcome", () => {
  afterEach(() => vi.restoreAllMocks());

  it("closes only after an exact opener acknowledgement", async () => {
    const harness = windowHarness({ opener: true, closeSucceeds: true });

    const completion = complete(harness, "success");
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: "pubky-passport.authorization-outcome",
      version: 1,
      outcome: "success",
      messageId: "outcome-message-id",
    }, "https://app.example");
    expect(harness.close).not.toHaveBeenCalled();

    harness.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(true);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.removeEventListener).toHaveBeenCalledOnce();
    expect(harness.clearTimeout).toHaveBeenCalledOnce();
    expect(JSON.stringify(harness.postMessage.mock.calls)).not.toContain("private=value");
  });

  it.each(["success", "error", "cancel"] as const)("supports the %s outcome", (outcome) => {
    const harness = windowHarness({ opener: true });

    void complete(harness, outcome);

    expect(harness.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ outcome }),
      "https://app.example",
    );
  });

  it("ignores acknowledgements from the wrong source, origin, or message", async () => {
    const harness = windowHarness({ opener: true, closeSucceeds: true });
    const completion = complete(harness, "cancel");

    harness.dispatchAcknowledgement({ source: {} as Window });
    harness.dispatchAcknowledgement({ origin: "https://attacker.example" });
    harness.dispatchAcknowledgement({
      data: { type: "wrong", version: 1, messageId: "outcome-message-id" },
    });

    expect(harness.close).not.toHaveBeenCalled();
    harness.runTimeout();
    await expect(completion).resolves.toBe(true);
    expect(harness.navigate).toHaveBeenCalledWith(CALLBACK);
    expect(harness.removeEventListener).toHaveBeenCalledOnce();
    expect(harness.clearTimeout).toHaveBeenCalledOnce();
  });

  it("navigates the current window when no live opener exists", async () => {
    const harness = windowHarness({ opener: false });

    await expect(complete(harness, "cancel")).resolves.toBe(true);
    expect(harness.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it("uses callback navigation when messaging fails or acknowledgement times out", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const messageFailure = windowHarness({ opener: true, postMessageFails: true });
    await expect(complete(messageFailure, "error")).resolves.toBe(true);
    expect(messageFailure.navigate).toHaveBeenCalledWith(CALLBACK);
    expect(messageFailure.removeEventListener).toHaveBeenCalledOnce();
    expect(messageFailure.clearTimeout).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.callback_handoff.failed", {
      operation: "post_message",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(CALLBACK);

    const timeout = windowHarness({ opener: true });
    const completion = complete(timeout, "success");
    timeout.runTimeout();
    await expect(completion).resolves.toBe(true);
    expect(timeout.navigate).toHaveBeenCalledWith(CALLBACK);
    expect(timeout.removeEventListener).toHaveBeenCalledOnce();
    expect(timeout.clearTimeout).toHaveBeenCalledOnce();
  });

  it("uses callback navigation when secure message ID generation fails", async () => {
    const harness = windowHarness({ opener: true, randomUuidFails: true });

    await expect(complete(harness, "success")).resolves.toBe(true);
    expect(harness.navigate).toHaveBeenCalledWith(CALLBACK);
    expect(harness.postMessage).not.toHaveBeenCalled();
  });

  it("uses callback navigation when acknowledged popup closing fails", async () => {
    const harness = windowHarness({ opener: true });
    const completion = complete(harness, "success");

    harness.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(true);
    expect(harness.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it.each([
    "removeEventListener",
    "clearTimeout",
  ] as const)("settles an acknowledgement when %s cleanup fails", async (failure) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const harness = windowHarness({ opener: true, closeSucceeds: true, cleanupFailure: failure });
    const completion = complete(harness, "success");

    harness.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(true);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.callback_handoff.failed", {
      operation: failure === "removeEventListener"
        ? "remove_message_listener"
        : "clear_acknowledgement_timeout",
    });
  });

  it("reports unavailable when direct callback navigation fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const harness = windowHarness({ opener: false, navigationFails: true });

    await expect(complete(harness, "cancel")).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith("authorize.callback_handoff.failed", {
      operation: "navigate",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(CALLBACK);
  });

  it("stops an active handoff when it is abandoned", async () => {
    const harness = windowHarness({ opener: true, closeSucceeds: true });
    const abortController = new AbortController();
    const completion = complete(harness, "success", abortController.signal);

    abortController.abort();
    harness.runTimeout();

    await expect(completion).resolves.toBe(true);
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.removeEventListener).toHaveBeenCalledOnce();
    expect(harness.clearTimeout).toHaveBeenCalledOnce();
  });

  it("does not start a handoff that was already abandoned", async () => {
    const harness = windowHarness({ opener: true });
    const abortController = new AbortController();
    abortController.abort();

    await expect(complete(
      harness,
      "success",
      abortController.signal,
    )).resolves.toBe(true);
    expect(harness.postMessage).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it.each([
    "http://app.example/callback",
    "javascript:alert(1)",
    "not a URL",
  ])("rejects an unvalidated callback: %s", async (callback) => {
    const harness = windowHarness({ opener: false });

    await expect(handoffAuthorizationOutcome(
      harness.window,
      callback,
      "success",
      new AbortController().signal,
    )).resolves.toBe(false);
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.postMessage).not.toHaveBeenCalled();
  });

  it("reports unavailable when messaging and callback navigation both fail", async () => {
    const harness = windowHarness({
      opener: true,
      postMessageFails: true,
      navigationFails: true,
    });

    await expect(complete(harness, "error")).resolves.toBe(false);
  });

  it("reports unavailable when acknowledgement times out and navigation fails", async () => {
    const harness = windowHarness({ opener: true, navigationFails: true });
    const completion = complete(harness, "cancel");

    harness.runTimeout();

    await expect(completion).resolves.toBe(false);
  });

  it("reports unavailable when acknowledged closing and navigation fail", async () => {
    const harness = windowHarness({ opener: true, navigationFails: true });
    const completion = complete(harness, "success");

    harness.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(false);
  });
});

function complete(
  harness: ReturnType<typeof windowHarness>,
  outcome: "success" | "error" | "cancel",
  signal: AbortSignal = new AbortController().signal,
): Promise<boolean> {
  return handoffAuthorizationOutcome(harness.window, CALLBACK, outcome, signal);
}

function windowHarness(input: {
  opener: boolean;
  cleanupFailure?: "removeEventListener" | "clearTimeout";
  closeSucceeds?: boolean;
  navigationFails?: boolean;
  postMessageFails?: boolean;
  randomUuidFails?: boolean;
}) {
  let listener: ((event: MessageEvent) => void) | undefined;
  let timeout: (() => void) | undefined;
  const navigate = vi.fn(() => {
    if (input.navigationFails) throw new Error("navigation failed");
  });
  const postMessage = vi.fn(() => {
    if (input.postMessageFails) throw new Error("messaging failed");
  });
  const opener = input.opener ? { closed: false, postMessage } as unknown as Window : null;
  const close = vi.fn(() => {
    if (input.closeSucceeds) state.closed = true;
  });
  const addEventListener = vi.fn((_type: string, next: (event: MessageEvent) => void) => {
    listener = next;
  });
  const clearTimeout = vi.fn(() => {
    if (input.cleanupFailure === "clearTimeout") throw new Error("cleanup failed");
    timeout = undefined;
  });
  const removeEventListener = vi.fn(() => {
    if (input.cleanupFailure === "removeEventListener") throw new Error("cleanup failed");
    listener = undefined;
  });
  const state = {
    addEventListener,
    clearTimeout,
    close,
    closed: false,
    crypto: {
      randomUUID: () => {
        if (input.randomUuidFails) throw new Error("random UUID failed");
        return "outcome-message-id";
      },
    },
    location: { replace: navigate },
    opener,
    removeEventListener,
    setTimeout: vi.fn((next: () => void) => {
      timeout = next;
      return 1;
    }),
  };
  return {
    window: state as unknown as Window,
    clearTimeout,
    close,
    navigate,
    postMessage,
    removeEventListener,
    dispatchAcknowledgement(overrides: Partial<MessageEvent> = {}) {
      listener?.({
        data: {
          type: "pubky-passport.authorization-outcome-ack",
          version: 1,
          messageId: "outcome-message-id",
        },
        origin: "https://app.example",
        source: opener,
        ...overrides,
      } as MessageEvent);
    },
    runTimeout() {
      timeout?.();
    },
  };
}
