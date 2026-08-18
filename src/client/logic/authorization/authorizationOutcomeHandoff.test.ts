import { describe, expect, it, vi } from "vitest";

import { AuthorizationOutcomeHandoff } from "./AuthorizationOutcomeHandoff";

const CALLBACK = "https://app.example/auth/passport/success?private=value";

describe("AuthorizationOutcomeHandoff", () => {
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
    expect(JSON.stringify(harness.postMessage.mock.calls)).not.toContain("private=value");
  });

  it.each(["success", "error", "cancel"] as const)("supports the %s outcome", (outcome) => {
    const harness = windowHarness({ opener: true });

    void complete(harness, outcome);

    expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({ outcome }), "https://app.example");
  });

  it("ignores acknowledgements from the wrong source, origin, or message", async () => {
    const harness = windowHarness({ opener: true, closeSucceeds: true });
    const completion = complete(harness, "cancel");

    harness.dispatchAcknowledgement({ source: {} as Window });
    harness.dispatchAcknowledgement({ origin: "https://attacker.example" });
    harness.dispatchAcknowledgement({ data: { type: "wrong", version: 1, messageId: "outcome-message-id" } });

    expect(harness.close).not.toHaveBeenCalled();
    harness.runTimeout();
    await expect(completion).resolves.toBe(true);
    expect(harness.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it("navigates the current window when no live opener exists", async () => {
    const harness = windowHarness({ opener: false });

    await expect(complete(harness, "cancel")).resolves.toBe(true);
    expect(harness.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it("uses callback navigation when messaging fails or acknowledgement times out", async () => {
    const messageFailure = windowHarness({ opener: true, postMessageFails: true });
    await expect(complete(messageFailure, "error")).resolves.toBe(true);
    expect(messageFailure.navigate).toHaveBeenCalledWith(CALLBACK);

    const timeout = windowHarness({ opener: true });
    const completion = complete(timeout, "success");
    timeout.runTimeout();
    await expect(completion).resolves.toBe(true);
    expect(timeout.navigate).toHaveBeenCalledWith(CALLBACK);
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

  it("reports unavailable when direct callback navigation fails", async () => {
    const harness = windowHarness({ opener: false, navigationFails: true });

    await expect(complete(harness, "cancel")).resolves.toBe(false);
  });

  it("reports unavailable when messaging and callback navigation both fail", async () => {
    const harness = windowHarness({ opener: true, postMessageFails: true, navigationFails: true });

    await expect(complete(harness, "error")).resolves.toBe(false);
  });

  it("reports unavailable when acknowledgement times out and callback navigation fails", async () => {
    const harness = windowHarness({ opener: true, navigationFails: true });
    const completion = complete(harness, "cancel");

    harness.runTimeout();

    await expect(completion).resolves.toBe(false);
  });

  it("reports unavailable when acknowledged closing and callback navigation fail", async () => {
    const harness = windowHarness({ opener: true, navigationFails: true });
    const completion = complete(harness, "success");

    harness.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(false);
  });
});

function complete(
  harness: ReturnType<typeof windowHarness>,
  outcome: "success" | "error" | "cancel",
): Promise<boolean> {
  return new AuthorizationOutcomeHandoff(harness.window).complete(CALLBACK, outcome);
}

function windowHarness(input: {
  opener: boolean;
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
  const state = {
    addEventListener: vi.fn((_type: string, next: (event: MessageEvent) => void) => { listener = next; }),
    clearTimeout: vi.fn(() => { timeout = undefined; }),
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
    removeEventListener: vi.fn(() => { listener = undefined; }),
    setTimeout: vi.fn((next: () => void) => { timeout = next; return 1; }),
  };
  return {
    window: state as unknown as Window,
    close,
    navigate,
    postMessage,
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
    runTimeout() { timeout?.(); },
  };
}
