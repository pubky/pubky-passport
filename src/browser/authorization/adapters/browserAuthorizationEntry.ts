import "client-only";

import { Result } from "better-result";

import {
  extractRawPubkyAuthRequestQueryValue,
  parsePubkyAuthRequest,
} from "../../../core/auth/parsePubkyAuthRequest";
import type { ParsedAuthorizationEntry } from "../application/authorizationEntry";

type PendingStrictModeEntry = {
  scrubbedHref: string;
  entry: ParsedAuthorizationEntry;
};

const PENDING_STRICT_MODE_ENTRIES = new WeakMap<Window, PendingStrictModeEntry>();

export function readAndScrubAuthorizationEntry(
  browserWindow: Window,
): ParsedAuthorizationEntry {
  const rawSearch = browserWindow.location.search;
  const scrubbedHref = `${browserWindow.location.origin}${browserWindow.location.pathname}${browserWindow.location.hash}`;
  // Avoid framework-patched history methods during render while scrubbing before commit.
  const HistoryConstructor = (browserWindow as Window & { History: typeof History }).History;
  HistoryConstructor.prototype.replaceState.call(
    browserWindow.history,
    null,
    "",
    `${browserWindow.location.pathname}${browserWindow.location.hash}`,
  );

  if (rawSearch.length === 0) {
    const pending = PENDING_STRICT_MODE_ENTRIES.get(browserWindow);
    if (pending?.scrubbedHref === scrubbedHref) {
      PENDING_STRICT_MODE_ENTRIES.delete(browserWindow);
      return pending.entry;
    }
  }

  const rawD = extractRawPubkyAuthRequestQueryValue(rawSearch);
  const parsed = parsePubkyAuthRequest(rawD.valid ? rawD.value : undefined);
  const entry: ParsedAuthorizationEntry = Result.isError(parsed)
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

export function commitAuthorizationEntry(browserWindow: Window): void {
  PENDING_STRICT_MODE_ENTRIES.delete(browserWindow);
}
