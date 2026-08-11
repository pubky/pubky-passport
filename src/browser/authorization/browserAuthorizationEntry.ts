import "client-only";

import { Result } from "better-result";

import { extractRawPubkyAuthRequestFragmentValue } from "../../core/auth/parsePubkyAuthRequest";
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
  const rawHash = browserWindow.location.hash;
  const scrubbedHref = `${browserWindow.location.origin}${browserWindow.location.pathname}`;
  scrubAuthorizationLocation(browserWindow);

  if (rawSearch.length === 0 && rawHash.length === 0) {
    const pending = PENDING_STRICT_MODE_ENTRIES.get(browserWindow);
    if (pending?.scrubbedHref === scrubbedHref) {
      PENDING_STRICT_MODE_ENTRIES.delete(browserWindow);
      return pending.entry;
    }
    return { status: "empty" };
  }

  const rawD = rawSearch.length === 0
    ? extractRawPubkyAuthRequestFragmentValue(rawHash)
    : { valid: false as const };
  const parsed = parseBrowserAuthorizationRequest(rawD.valid ? rawD.value : undefined);
  if (Result.isError(parsed)) {
    LOGGER.info("authorize.parse.failed", {
      source: "fragment",
      code: rawD.valid ? parsed.error.code : "invalid_fragment_shape",
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

export function scrubAuthorizationLocation(
  browserWindow: Window,
  preserveSafeHistoryState = false,
): void {
  // Avoid framework-patched history methods during render while scrubbing before commit.
  const HistoryConstructor = (browserWindow as Window & { History: typeof History }).History;
  try {
    HistoryConstructor.prototype.replaceState.call(
      browserWindow.history,
      preserveSafeHistoryState ? safeHistoryState(browserWindow) : null,
      "",
      browserWindow.location.pathname,
    );
  } catch {
    LOGGER.warn("authorize.entry.failed", {
      operation: "scrub_fragment",
      code: "history_unavailable",
    });
    throw new Error("Authorization entry could not be scrubbed.");
  }
}

function safeHistoryState(browserWindow: Window): unknown {
  const state = browserWindow.history.state as unknown;
  if (state === null) return null;

  try {
    const serialized = JSON.stringify(state);
    if (
      serialized === undefined
      || serialized.length > 32_768
      || (browserWindow.location.hash !== "" && serialized.includes(browserWindow.location.hash))
      || (browserWindow.location.search !== "" && serialized.includes(browserWindow.location.search))
      || /pubkyauth(?::|%3a)|(?:#|%23|\?|%3f)d(?:=|%3d)/iu.test(serialized)
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function clearPendingAuthorizationEntry(browserWindow: Window): void {
  PENDING_STRICT_MODE_ENTRIES.delete(browserWindow);
}
