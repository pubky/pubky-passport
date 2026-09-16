import { describe, expect, it, vi } from "vitest";

import { handoffSignupInvite, signupCallbackUrl } from "./signupInviteHandoff";

const request = {
  callback: "https://app.example/return?from=signup",
  clientOrigin: "https://app.example",
  state: "test_signup_state_1234",
};
const invite = {
  homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
  signupToken: "invite+token/=",
};

describe("signup invite handoff", () => {
  it("returns hs, st and state only in the callback fragment", () => {
    const url = new URL(signupCallbackUrl(request, invite));
    expect(url.search).toBe("?from=signup");
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      hs: invite.homeserverPubky,
      st: invite.signupToken,
      state: request.state,
    });
  });
  it("navigates in the same tab when there is no opener", async () => {
    const replace = vi.fn();
    const window = { opener: null, location: { replace } } as unknown as Window;
    expect(await handoffSignupInvite(window, request, invite, new AbortController().signal)).toBe(
      "navigated",
    );
    expect(replace).toHaveBeenCalledWith(signupCallbackUrl(request, invite));
  });
  it("sends only an invite to the exact client origin and closes after its matching acknowledgement", async () => {
    const events = new EventTarget();
    const close = vi.fn();
    const opener = {
      closed: false,
      postMessage: vi.fn((data) => {
        const event = new Event("message");
        Object.assign(event, {
          source: opener,
          origin: request.clientOrigin,
          data: { type: "pubky-passport.signup-invite-ack", version: 1, messageId: data.messageId },
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
    expect(await handoffSignupInvite(window, request, invite, new AbortController().signal)).toBe(
      "acknowledged-and-closed",
    );
    expect(opener.postMessage).toHaveBeenCalledWith(
      {
        type: "pubky-passport.signup-invite",
        version: 1,
        messageId: "message-1234",
        state: request.state,
        hs: invite.homeserverPubky,
        st: invite.signupToken,
      },
      request.clientOrigin,
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
