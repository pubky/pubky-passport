import "client-only";

import { LOGGER } from "../../../../libs/logger/logger";

/** Removes authorization query and fragment data using the native History API. */
export function scrubAuthorizationLocation(
  appWindow: Window,
  options: { preserveSanitizedHistoryState?: boolean } = {},
): void {
  // Avoid framework-patched history methods while scrubbing before React commits.
  const HistoryConstructor = (appWindow as Window & { History: typeof History }).History;
  try {
    HistoryConstructor.prototype.replaceState.call(
      appWindow.history,
      options.preserveSanitizedHistoryState ? safeHistoryState(appWindow) : null,
      "",
      appWindow.location.pathname,
    );
  } catch {
    LOGGER.warn("authorize.entry.failed", {
      operation: "scrub_fragment",
      code: "history_unavailable",
    });
    throw new Error("Authorization entry could not be scrubbed.");
  }
}

function safeHistoryState(appWindow: Window): unknown {
  const state = appWindow.history.state as unknown;
  if (state === null) return null;

  try {
    const serialized = JSON.stringify(state);
    if (
      serialized === undefined
      || serialized.length > 32_768
      || (appWindow.location.hash !== "" && serialized.includes(appWindow.location.hash))
      || (appWindow.location.search !== "" && serialized.includes(appWindow.location.search))
      || /pubkyauth(?::|%3a)|(?:#|%23|\?|%3f)d(?:=|%3d)/iu.test(serialized)
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}
