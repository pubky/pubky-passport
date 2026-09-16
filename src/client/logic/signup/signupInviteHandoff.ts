import "client-only";

import { handoffClientMessage } from "@/client/logic/handoff/clientHandoff";
import type { HomeserverSignupDetails } from "@/client/logic/homegate/homegateSignup";
import type { SignupRequest } from "./signupRequest";

export function signupCallbackUrl(request: SignupRequest, invite: HomeserverSignupDetails): string {
  const callback = new URL(request.callback);
  // Invitations travel in the fragment so the client's HTTP server never receives them.
  callback.hash = new URLSearchParams({
    hs: invite.homeserverPubky,
    st: invite.signupToken,
    state: request.state,
  }).toString();
  return callback.href;
}

/** Returns an invite, never a key or a signed grant. The client constructs signup_grant itself. */
export function handoffSignupInvite(
  appWindow: Window,
  request: SignupRequest,
  invite: HomeserverSignupDetails,
  signal: AbortSignal,
) {
  return handoffClientMessage(
    appWindow,
    signupCallbackUrl(request, invite),
    {
      type: "pubky-passport.signup-invite",
      acknowledgementType: "pubky-passport.signup-invite-ack",
      payload: { hs: invite.homeserverPubky, st: invite.signupToken, state: request.state },
    },
    signal,
  );
}
