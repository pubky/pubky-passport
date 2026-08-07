import "client-only";

import { Result } from "better-result";

import { extractRawPubkyAuthRequestQueryValue } from "../../core/auth/parsePubkyAuthRequest";
import { LOGGER } from "../../libs/logger/logger";
import {
  parseBrowserAuthorizationRequest,
  type AuthorizationRequestReview,
  type PubkyAuthApprovalCapability,
} from "./browserAuthorizationRequest";

export type AuthorizationEntry =
  | { status: "valid"; review: AuthorizationRequestReview; approval: PubkyAuthApprovalCapability }
  | { status: "empty" }
  | { status: "invalid" };

type PendingStrictModeEntry = {
  scrubbedHref: string;
  entry: AuthorizationEntry;
};

const PENDING_STRICT_MODE_ENTRIES = new WeakMap<Window, PendingStrictModeEntry>();

export function readAndScrubAuthorizationEntry(
  browserWindow: Window,
): AuthorizationEntry {
  const rawSearch = browserWindow.location.search;
  const scrubbedHref = `${browserWindow.location.origin}${browserWindow.location.pathname}${browserWindow.location.hash}`;
  // Avoid framework-patched history methods during render while scrubbing before commit.
  const HistoryConstructor = (browserWindow as Window & { History: typeof History }).History;
  try {
    HistoryConstructor.prototype.replaceState.call(
      browserWindow.history,
      null,
      "",
      `${browserWindow.location.pathname}${browserWindow.location.hash}`,
    );
  } catch {
    LOGGER.warn("authorize.entry.failed", {
      operation: "scrub_query",
      code: "history_unavailable",
    });
    throw new Error("Authorization entry could not be scrubbed.");
  }

  if (rawSearch.length === 0) {
    const pending = PENDING_STRICT_MODE_ENTRIES.get(browserWindow);
    if (pending?.scrubbedHref === scrubbedHref) {
      PENDING_STRICT_MODE_ENTRIES.delete(browserWindow);
      return pending.entry;
    }
    return { status: "empty" };
  }

  const rawD = extractRawPubkyAuthRequestQueryValue(rawSearch);
  const parsed = parseBrowserAuthorizationRequest(rawD.valid ? rawD.value : undefined);
  if (Result.isError(parsed)) {
    LOGGER.info("authorize.parse.failed", {
      source: "query",
      code: rawD.valid ? parsed.error.code : "invalid_query_shape",
    });
  }
  const entry: AuthorizationEntry = Result.isError(parsed)
    ? { status: "invalid" }
    : { status: "valid", review: parsed.value.review, approval: parsed.value.approval };
  const pending = { scrubbedHref, entry };
  PENDING_STRICT_MODE_ENTRIES.set(browserWindow, pending);
  queueMicrotask(() => {
    if (PENDING_STRICT_MODE_ENTRIES.get(browserWindow) === pending) {
      PENDING_STRICT_MODE_ENTRIES.delete(browserWindow);
    }
  });
  return entry;
}

export function clearPendingAuthorizationEntry(browserWindow: Window): void {
  PENDING_STRICT_MODE_ENTRIES.delete(browserWindow);
}
