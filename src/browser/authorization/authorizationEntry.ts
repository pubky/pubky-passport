import "client-only";

import { Result } from "better-result";

import {
  parsePubkyAuthRequest,
  type PubkyAuthRequestReview,
  type ValidatedSensitivePubkyAuthRequest,
} from "../../features/auth/parsePubkyAuthRequest";

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
  relayOrigin: string,
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

  const rawD = extractRawDQueryValue(rawSearch);
  const parsed = parsePubkyAuthRequest(rawD.valid ? rawD.value : undefined, {
    allowedRelayOrigins: [relayOrigin],
  });
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

function extractRawDQueryValue(search: string): { valid: true; value?: string } | { valid: false } {
  let value: string | undefined;

  for (const parameter of search.slice(1).split("&")) {
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    if (name !== "d") continue;
    if (separator === -1 || value !== undefined) return { valid: false };
    value = parameter.slice(separator + 1);
  }

  return value === undefined ? { valid: true } : { valid: true, value };
}
