import "client-only";

import { Result } from "better-result";

import {
  EARLY_AUTHORIZATION_LOCATION_LIFETIME_MS,
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
  type EarlyAuthorizationLocation,
} from "../../../../libs/authorization/earlyAuthorizationLocation";
import { LOGGER } from "../../../../libs/logger/logger";
import {
  issueAuthorizationRequest,
  releaseAuthorizationApproval,
  type AuthorizationRequestReview,
  type PubkyAuthApprovalCapability,
} from "../request/issuedAuthorizationRequest";
import { extractAuthorizationFragmentValue } from "./extractAuthorizationFragmentValue";
import { scrubAuthorizationLocation } from "./scrubAuthorizationLocation";

export type AuthorizationEntry =
  | {
    status: "valid";
    review: AuthorizationRequestReview;
    approval: PubkyAuthApprovalCapability;
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
  const parsed = issueAuthorizationRequest(rawD.valid ? rawD.value : undefined);
  if (Result.isError(parsed)) {
    LOGGER.info("authorize.parse.failed", {
      source: "fragment",
      code: rawD.valid ? parsed.error.code : "invalid_fragment_shape",
    });
  }
  const entry: AuthorizationEntry = Result.isError(parsed)
    ? { status: "invalid" }
    : {
      status: "valid",
      review: parsed.value.review,
      approval: parsed.value.approval,
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

/** Clears the short-lived StrictMode entry after the first render commits. */
export function clearPendingAuthorizationEntry(appWindow: Window): void {
  const pending = PENDING_STRICT_MODE_ENTRIES.get(appWindow);
  if (pending) appWindow.clearTimeout(pending.timeoutId);
  PENDING_STRICT_MODE_ENTRIES.delete(appWindow);
}

/** Invalidates private approval metadata when an unconsumed entry expires. */
export function expireAuthorizationEntry(entry: AuthorizationEntry): AuthorizationEntry {
  if (entry.status === "valid") releaseAuthorizationApproval(entry.approval);
  return { status: "expired" };
}
