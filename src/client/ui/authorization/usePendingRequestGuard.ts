import { useEffect } from "react";

import { guardPendingRequest } from "@/client/logic/authorization/flow/leaveGuard";
import type { AuthorizationController } from "./usePassportAuthorization";

/**
 * While the page's request waits in review (which includes creating an account for it), asks the
 * browser to confirm before a reload, Back or closing the window drops it without telling the app.
 * A popup with a live opener is left alone: the app closes it itself (see `guardPendingRequest`).
 */
export function usePendingRequestGuard(controller: AuthorizationController | null): void {
  useEffect(() => {
    if (!controller) return undefined;
    return guardPendingRequest(window, () => controller.getState().status === "review");
  }, [controller]);
}
