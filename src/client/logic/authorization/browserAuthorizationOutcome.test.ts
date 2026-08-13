import { describe, expect, it, vi } from "vitest";

import { completeBrowserAuthorizationOutcome } from "./browserAuthorizationOutcome";

const CALLBACK = "https://app.example/auth/passport/success?private=value";

describe("completeBrowserAuthorizationOutcome", () => {
  it("closes only after an exact opener acknowledgement", async () => {
    const browser = browserWindow({ opener: true, closeSucceeds: true });

    const completion = completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "success");
    expect(browser.postMessage).toHaveBeenCalledWith({
      type: "pubky-passport.authorization-outcome",
      version: 1,
      outcome: "success",
      messageId: "outcome-message-id",
    }, "https://app.example");
    expect(browser.close).not.toHaveBeenCalled();

    browser.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(true);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(browser.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(browser.postMessage.mock.calls)).not.toContain("private=value");
  });

  it.each(["success", "error", "cancel"] as const)("supports the %s outcome", (outcome) => {
    const browser = browserWindow({ opener: true });

    completeBrowserAuthorizationOutcome(browser.window, CALLBACK, outcome);

    expect(browser.postMessage).toHaveBeenCalledWith(expect.objectContaining({ outcome }), "https://app.example");
  });

  it("ignores acknowledgements from the wrong source, origin, or message", async () => {
    const browser = browserWindow({ opener: true, closeSucceeds: true });
    const completion = completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "cancel");

    browser.dispatchAcknowledgement({ source: {} as Window });
    browser.dispatchAcknowledgement({ origin: "https://attacker.example" });
    browser.dispatchAcknowledgement({ data: { type: "wrong", version: 1, messageId: "outcome-message-id" } });

    expect(browser.close).not.toHaveBeenCalled();
    browser.runTimeout();
    await expect(completion).resolves.toBe(true);
    expect(browser.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it("navigates the current window when no live opener exists", async () => {
    const browser = browserWindow({ opener: false });

    await expect(completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "cancel")).resolves.toBe(true);
    expect(browser.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it("uses callback navigation when messaging fails or acknowledgement times out", async () => {
    const messageFailure = browserWindow({ opener: true, postMessageFails: true });
    await expect(completeBrowserAuthorizationOutcome(messageFailure.window, CALLBACK, "error")).resolves.toBe(true);
    expect(messageFailure.navigate).toHaveBeenCalledWith(CALLBACK);

    const timeout = browserWindow({ opener: true });
    const completion = completeBrowserAuthorizationOutcome(timeout.window, CALLBACK, "success");
    timeout.runTimeout();
    await expect(completion).resolves.toBe(true);
    expect(timeout.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it("uses callback navigation when acknowledged popup closing fails", async () => {
    const browser = browserWindow({ opener: true });
    const completion = completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "success");

    browser.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(true);
    expect(browser.navigate).toHaveBeenCalledWith(CALLBACK);
  });

  it("reports unavailable when direct callback navigation fails", async () => {
    const browser = browserWindow({ opener: false, navigationFails: true });

    await expect(completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "cancel")).resolves.toBe(false);
  });

  it("reports unavailable when messaging and callback navigation both fail", async () => {
    const browser = browserWindow({ opener: true, postMessageFails: true, navigationFails: true });

    await expect(completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "error")).resolves.toBe(false);
  });

  it("reports unavailable when acknowledgement times out and callback navigation fails", async () => {
    const browser = browserWindow({ opener: true, navigationFails: true });
    const completion = completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "cancel");

    browser.runTimeout();

    await expect(completion).resolves.toBe(false);
  });

  it("reports unavailable when acknowledged closing and callback navigation fail", async () => {
    const browser = browserWindow({ opener: true, navigationFails: true });
    const completion = completeBrowserAuthorizationOutcome(browser.window, CALLBACK, "success");

    browser.dispatchAcknowledgement();

    await expect(completion).resolves.toBe(false);
  });
});

function browserWindow(input: {
  opener: boolean;
  closeSucceeds?: boolean;
  navigationFails?: boolean;
  postMessageFails?: boolean;
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
    crypto: { randomUUID: () => "outcome-message-id" },
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
