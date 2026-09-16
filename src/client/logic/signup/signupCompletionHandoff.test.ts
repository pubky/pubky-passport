import { describe, expect, it, vi } from "vitest";

import { handoffSignupCompletion, signupCallbackUrl } from "./signupCompletionHandoff";

const request = {
  callback: "https://app.example/return?from=signup",
  clientOrigin: "https://app.example",
  state: "test_signup_state_1234",
};

describe("signup completion handoff", () => {
  it("returns completion and state only in the callback fragment", () => {
    const url = new URL(signupCallbackUrl(request));
    expect(url.search).toBe("?from=signup");
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      signup: "complete",
      state: request.state,
    });
  });
  it("navigates in the same tab when there is no opener", async () => {
    const replace = vi.fn();
    const window = { opener: null, location: { replace } } as unknown as Window;
    expect(await handoffSignupCompletion(window, request, new AbortController().signal)).toBe(
      "navigated",
    );
    expect(replace).toHaveBeenCalledWith(signupCallbackUrl(request));
  });
  it("sends only completion to the exact client origin and closes after its matching acknowledgement", async () => {
    const events = new EventTarget();
    const close = vi.fn();
    const opener = {
      closed: false,
      postMessage: vi.fn((data) => {
        const event = new Event("message");
        Object.assign(event, {
          source: opener,
          origin: request.clientOrigin,
          data: {
            type: "pubky-passport.signup-complete-ack",
            version: 1,
            messageId: data.messageId,
          },
        });
        events.dispatchEvent(event);
      }),
    };
    const window = {
      opener,
      crypto: { randomUUID: () => "message-1234" },
      closed: true,
      close,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      setTimeout,
      clearTimeout,
      location: { replace: vi.fn() },
    } as unknown as Window;
    expect(await handoffSignupCompletion(window, request, new AbortController().signal)).toBe(
      "acknowledged-and-closed",
    );
    expect(opener.postMessage).toHaveBeenCalledWith(
      {
        type: "pubky-passport.signup-complete",
        version: 1,
        messageId: "message-1234",
        state: request.state,
      },
      request.clientOrigin,
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
