import "client-only";

import { Result } from "better-result";

import {
  extractRawPubkyAuthRequestQueryValue,
  parsePubkyAuthRequest,
  type PubkyAuthRequestReview,
  type ValidatedSensitivePubkyAuthRequest,
} from "../../core/auth/parsePubkyAuthRequest";

export type ParsedAuthorizationEntry =
  | { status: "valid"; review: PubkyAuthRequestReview; approval: ValidatedSensitivePubkyAuthRequest }
  | { status: "invalid" };

type PendingStrictModeEntry = {
  scrubbedHref: string;
  entry: ParsedAuthorizationEntry;
};

const pendingStrictModeEntries = new WeakMap<Window, PendingStrictModeEntry>();

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
    const pending = pendingStrictModeEntries.get(browserWindow);
    if (pending?.scrubbedHref === scrubbedHref) {
      pendingStrictModeEntries.delete(browserWindow);
      return pending.entry;
    }
  }

  const rawD = extractRawPubkyAuthRequestQueryValue(rawSearch);
  const parsed = parsePubkyAuthRequest(rawD.valid ? rawD.value : undefined);
  const entry: ParsedAuthorizationEntry = Result.isError(parsed)
    ? { status: "invalid" }
    : { status: "valid", review: parsed.value.review, approval: parsed.value.approval };
  const pending = { scrubbedHref, entry };
  pendingStrictModeEntries.set(browserWindow, pending);
  queueMicrotask(() => {
    if (pendingStrictModeEntries.get(browserWindow) === pending) {
      pendingStrictModeEntries.delete(browserWindow);
    }
  });
  return entry;
}

export function clearPendingAuthorizationEntry(browserWindow: Window): void {
  pendingStrictModeEntries.delete(browserWindow);
}
