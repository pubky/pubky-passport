import "client-only";

import { handoffClientMessage } from "@/client/logic/handoff/clientHandoff";

export type { ClientHandoffStatus as AuthorizationHandoffStatus } from "@/client/logic/handoff/clientHandoff";
export type AuthorizationOutcome = "success" | "error" | "cancel";

/** Returns the UI outcome to the client after authorization, using an acknowledged popup or navigation. */
export function handoffAuthorizationOutcome(
  appWindow: Window,
  callback: string,
  outcome: AuthorizationOutcome,
  signal: AbortSignal,
) {
  return handoffClientMessage(
    appWindow,
    callback,
    {
      type: "pubky-passport.authorization-outcome",
      acknowledgementType: "pubky-passport.authorization-outcome-ack",
      payload: { outcome },
    },
    signal,
  );
}
