import "client-only";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { AuthorizationHandoffStatus } from "./authorizationOutcomeHandoff";

/** A user-requested return is navigation only, never an authorization outcome. */
export function navigateExternalReturn(
  appWindow: Window,
  callback: string | undefined,
): Extract<AuthorizationHandoffStatus, "navigated" | "unavailable"> {
  if (!callback) return "unavailable";
  try {
    const url = new URL(callback);
    if (url.protocol !== "https:" || url.username || url.password) return "unavailable";
    appWindow.location.replace(callback);
    return "navigated";
  } catch (e) {
    LOGGER.warn("authorize.external_return.failed", {
      operation: "navigate",
      ...safeErrorLogFields(e),
    });
    return "unavailable";
  }
}
