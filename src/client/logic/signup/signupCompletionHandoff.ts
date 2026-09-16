import "client-only";

import { handoffClientMessage } from "@/client/logic/handoff/clientHandoff";
import type { SignupRequest } from "./signupRequest";

export function signupCallbackUrl(request: SignupRequest): string {
  const callback = new URL(request.callback);
  // Keep the attempt state in the fragment, out of HTTP requests.
  callback.hash = new URLSearchParams({
    signup: "complete",
    state: request.state,
  }).toString();
  return callback.href;
}

/** User-reported completion only; the client must authenticate separately with Ring. */
export function handoffSignupCompletion(
  appWindow: Window,
  request: SignupRequest,
  signal: AbortSignal,
) {
  return handoffClientMessage(
    appWindow,
    signupCallbackUrl(request),
    {
      type: "pubky-passport.signup-complete",
      acknowledgementType: "pubky-passport.signup-complete-ack",
      payload: { state: request.state },
    },
    signal,
  );
}
