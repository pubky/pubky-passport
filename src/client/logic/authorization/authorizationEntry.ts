import "client-only";

import { Result } from "better-result";

import {
  EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS,
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
  type EarlyAuthorizationLocation,
} from "../../../libs/authorization/earlyAuthorizationLocation";
import { LOGGER } from "../../../libs/logger/logger";
import { IssuedPubkyAuthRequest } from "./IssuedPubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

export type AuthorizationEntry =
  | {
    status: "valid";
    request: IssuedPubkyAuthRequest;
    expiresAt: number;
  }
  | { status: "empty" }
  | { status: "expired" }
  | { status: "invalid" };

type PendingStrictModeEntry = {
  scrubbedHref: string;
  entry: AuthorizationEntry;
  timeoutId: number;
};

// Keeps one short-lived entry per Window without retaining closed windows.
const PENDING_STRICT_MODE_ENTRIES = new WeakMap<Window, PendingStrictModeEntry>();

/**
 * Consumes the early authorization capture, scrubs the address bar, and returns
 * only a safe entry state for controller construction.
 */
export function readAndScrubAuthorizationEntry(
  appWindow: Window,
): AuthorizationEntry {
  const earlyLocation = takeEarlyAuthorizationLocation(appWindow);
  const rawSearch = earlyLocation?.status === "captured" ? "" : appWindow.location.search;
  const rawHash = earlyLocation?.status === "captured" ? earlyLocation.hash : appWindow.location.hash;
  const scrubbedHref = `${appWindow.location.origin}${appWindow.location.pathname}`;
  scrubAuthorizationLocation(appWindow);

  if (earlyLocation?.status === "expired") {
    return retainForStrictMode(appWindow, scrubbedHref, { status: "expired" });
  }

  if (earlyLocation?.status === "too_large" || earlyLocation?.status === "invalid_search") {
    return retainForStrictMode(appWindow, scrubbedHref, { status: "invalid" });
  }

  if (earlyLocation?.status === "captured" && Date.now() >= earlyLocation.expiresAt) {
    return retainForStrictMode(appWindow, scrubbedHref, { status: "expired" });
  }

  if (rawSearch.length === 0 && rawHash.length === 0) {
    const pending = PENDING_STRICT_MODE_ENTRIES.get(appWindow);
    if (pending?.scrubbedHref === scrubbedHref) {
      return pending.entry;
    }
    return { status: "empty" };
  }

  const rawD = rawSearch.length === 0
    ? extractAuthorizationFragmentValue(rawHash)
    : { valid: false as const };
  const issued = IssuedPubkyAuthRequest.issue(rawD.valid ? rawD.value : undefined);
  if (Result.isError(issued)) {
    LOGGER.info("authorize.parse.failed", {
      source: "fragment",
      code: rawD.valid ? issued.error.code : "invalid_fragment_shape",
    });
  }
  const entry: AuthorizationEntry = Result.isError(issued)
    ? { status: "invalid" }
    : {
      status: "valid",
      request: issued.value,
      expiresAt: earlyLocation?.status === "captured"
        ? earlyLocation.expiresAt
        : Date.now() + EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS,
    };
  return retainForStrictMode(appWindow, scrubbedHref, entry);
}

function retainForStrictMode(
  appWindow: Window,
  scrubbedHref: string,
  entry: AuthorizationEntry,
): AuthorizationEntry {
  clearPendingAuthorizationEntry(appWindow);
  const lifetime = entry.status === "valid"
    ? Math.max(0, entry.expiresAt - Date.now())
    : EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS;
  if (entry.status === "valid" && lifetime === 0) {
    return expireAuthorizationEntry(entry);
  }

  const pending: PendingStrictModeEntry = { scrubbedHref, entry, timeoutId: 0 };
  PENDING_STRICT_MODE_ENTRIES.set(appWindow, pending);
  pending.timeoutId = appWindow.setTimeout(() => {
    if (PENDING_STRICT_MODE_ENTRIES.get(appWindow) === pending) {
      PENDING_STRICT_MODE_ENTRIES.delete(appWindow);
      expireAuthorizationEntry(pending.entry);
    }
  }, lifetime);
  return entry;
}

function takeEarlyAuthorizationLocation(appWindow: Window): EarlyAuthorizationLocation | undefined {
  const take = (appWindow as Window & Record<string, unknown>)[EARLY_AUTHORIZATION_LOCATION_PROPERTY];
  if (typeof take !== "function") return undefined;
  try {
    const value: unknown = take();
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const capture = value as Record<string, unknown>;
    if (
      capture.status === "expired"
      || capture.status === "too_large"
      || capture.status === "invalid_search"
    ) {
      return { status: capture.status };
    }
    return capture.status === "captured"
      && typeof capture.hash === "string"
      && typeof capture.expiresAt === "number"
      && Number.isFinite(capture.expiresAt)
      ? { status: "captured", hash: capture.hash, expiresAt: capture.expiresAt }
      : undefined;
  } catch {
    return undefined;
  }
}

function extractAuthorizationFragmentValue(
  hash: string,
): { valid: true; value?: string } | { valid: false } {
  if (hash.length > PUBKY_AUTH_REQUEST_LIMITS.encodedDLength + "#d=".length) {
    return { valid: false };
  }

  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.length === 0) return { valid: true };

  let value: string | undefined;
  for (const parameter of fragment.split("&")) {
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    if (name !== "d" || separator === -1 || value !== undefined) {
      return { valid: false };
    }
    value = parameter.slice(separator + 1);
  }

  return value === undefined ? { valid: true } : { valid: true, value };
}

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

/** Clears the short-lived StrictMode entry after the first render commits. */
export function clearPendingAuthorizationEntry(appWindow: Window): void {
  const pending = PENDING_STRICT_MODE_ENTRIES.get(appWindow);
  if (pending) appWindow.clearTimeout(pending.timeoutId);
  PENDING_STRICT_MODE_ENTRIES.delete(appWindow);
}

/** Invalidates private approval metadata when an unconsumed entry expires. */
export function expireAuthorizationEntry(entry: AuthorizationEntry): AuthorizationEntry {
  if (entry.status === "valid") IssuedPubkyAuthRequest.release(entry.request);
  return { status: "expired" };
}
