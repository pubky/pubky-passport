import "client-only";

import { Result } from "better-result";

import {
  AUTHORIZATION_ENTRY_PATH,
  FORWARDED_QUERY,
  GOOGLE_CREDENTIAL_FRAGMENT_SOURCE,
  REQUEST_MARKER_SOURCE,
  REQUEST_QUERY_SOURCE,
} from "@/libs/authorization/authorizationLocationRules";
import {
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
  type EarlyAuthorizationLocation,
} from "@/libs/authorization/earlyAuthorizationLocation";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { AUTHORIZATION_CAPTURE_MAX_CHARACTERS } from "@/libs/passportPolicy";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import {
  PUBKY_AUTH_REQUEST_LIMITS,
  type PubkyAuthParseError,
} from "@/client/logic/authorization/request/parser/pubkyAuthRequestParser";

export type AuthorizationEntryCode =
  | PubkyAuthParseError["code"]
  | "invalid_fragment_shape"
  | "invalid_search"
  | "too_large"
  | "history_unavailable";

export type AuthorizationEntry =
  | {
      status: "valid";
      request: ValidatedPubkyAuthRequest;
      /** The app asked, next to `d=`, for an identity with a pubky.app profile. */
      profile?: "required";
    }
  | { status: "empty" }
  | { status: "expired" }
  | { status: "invalid"; code: AuthorizationEntryCode };

const GOOGLE_CREDENTIAL_FRAGMENT = new RegExp(GOOGLE_CREDENTIAL_FRAGMENT_SOURCE);
const REQUEST_MARKER = new RegExp(REQUEST_MARKER_SOURCE, "i");
const REQUEST_QUERY = new RegExp(REQUEST_QUERY_SOURCE);

/**
 * Consumes the early authorization capture, scrubs the address bar, and returns
 * only a safe entry state for controller construction.
 */
export function readAndScrubAuthorizationEntry(appWindow: Window): AuthorizationEntry {
  const earlyLocation = takeEarlyAuthorizationLocation(appWindow);
  const rawSearch = earlyLocation?.status === "captured" ? "" : appWindow.location.search;
  const rawHash =
    earlyLocation?.status === "captured" ? earlyLocation.hash : appWindow.location.hash;
  if (!scrubAuthorizationLocation(appWindow))
    return { status: "invalid", code: "history_unavailable" };

  if (earlyLocation?.status === "expired") {
    return { status: "expired" };
  }

  if (earlyLocation?.status === "too_large" || earlyLocation?.status === "invalid_search") {
    return { status: "invalid", code: earlyLocation.status };
  }

  if (earlyLocation?.status === "captured" && Date.now() >= earlyLocation.expiresAt) {
    return { status: "expired" };
  }

  // A plain query string carries no request; legacy query transport, or a query next to a
  // fragment, is rejected.
  const queryInvalidatesEntry =
    rawSearch.length > 0 && (rawHash.length > 0 || REQUEST_QUERY.test(rawSearch));
  if (!queryInvalidatesEntry && rawHash.length === 0) {
    return { status: "empty" };
  }

  const rawD = queryInvalidatesEntry
    ? { valid: false as const, code: "invalid_search" as const }
    : extractAuthorizationFragmentValue(rawHash);
  const validated = ValidatedPubkyAuthRequest.fromEncoded(rawD.valid ? rawD.value : undefined);
  if (Result.isError(validated)) {
    LOGGER.info("authorize.parse.failed", {
      source: "fragment",
      code: rawD.valid ? validated.error.code : "invalid_fragment_shape",
    });
    return { status: "invalid", code: rawD.valid ? validated.error.code : rawD.code };
  }
  return {
    status: "valid",
    request: validated.value,
    ...(rawD.valid && rawD.profile === "required" ? { profile: "required" as const } : {}),
  };
}

function takeEarlyAuthorizationLocation(appWindow: Window): EarlyAuthorizationLocation | undefined {
  const take = (appWindow as Window & Record<string, unknown>)[
    EARLY_AUTHORIZATION_LOCATION_PROPERTY
  ];
  if (typeof take !== "function") return undefined;
  try {
    const value: unknown = take();
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const capture = value as Record<string, unknown>;
    if (
      capture.status === "expired" ||
      capture.status === "too_large" ||
      capture.status === "invalid_search"
    ) {
      return { status: capture.status };
    }
    return capture.status === "captured" &&
      typeof capture.hash === "string" &&
      typeof capture.expiresAt === "number" &&
      Number.isFinite(capture.expiresAt)
      ? { status: "captured", hash: capture.hash, expiresAt: capture.expiresAt }
      : undefined;
  } catch (e) {
    LOGGER.warn("authorize.entry.failed", {
      operation: "take_early_capture",
      code: "capture_unavailable",
      ...safeErrorLogFields(e),
    });
    return undefined;
  }
}

/** The longest form of the one parameter an app may add next to `d=`: its profile requirement. */
const LONGEST_PROFILE_PARAMETER = "&profile=optional";

function extractAuthorizationFragmentValue(
  hash: string,
):
  | { valid: true; value?: string; profile?: "required" | "optional" }
  | { valid: false; code: "too_large" | "invalid_fragment_shape" } {
  if (
    hash.length >
    PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits +
      "#d=".length +
      LONGEST_PROFILE_PARAMETER.length
  ) {
    return { valid: false, code: "too_large" };
  }

  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.length === 0) return { valid: true };

  let value: string | undefined;
  let profile: "required" | "optional" | undefined;
  for (const parameter of fragment.split("&")) {
    if (parameter.length > PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits + "d=".length) {
      return { valid: false, code: "too_large" };
    }
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    const parameterValue = parameter.slice(separator + 1);
    if (
      name === "profile" &&
      profile === undefined &&
      (parameterValue === "required" || parameterValue === "optional")
    ) {
      profile = parameterValue;
      continue;
    }
    if (name !== "d" || separator === -1 || value !== undefined) {
      return { valid: false, code: "invalid_fragment_shape" };
    }
    value = parameterValue;
  }

  // The requirement only accompanies a request; alone it is not an entry.
  if (value === undefined)
    return profile === undefined
      ? { valid: true }
      : { valid: false, code: "invalid_fragment_shape" };
  return { valid: true, value, ...(profile ? { profile } : {}) };
}

/**
 * Sends a request that reached `/` on to the authorization entry, which alone accepts requests.
 * The parser-time script normally does this before any app code runs; this is its fallback and
 * keeps its order: the request leaves the address bar and loading stops before navigating. A
 * query is replaced by the valueless `FORWARDED_QUERY`, never copied.
 */
export function forwardHomeAuthorizationRequest(appWindow: Window): boolean {
  const { hash, search } = appWindow.location;
  if (GOOGLE_CREDENTIAL_FRAGMENT.test(hash.slice(1)) || !REQUEST_MARKER.test(search + hash)) {
    return false;
  }
  const destination = `${AUTHORIZATION_ENTRY_PATH}${search === "" ? "" : FORWARDED_QUERY}${hash}`;
  // A failed scrub already navigates to a clean `/`; the forward below supersedes it.
  scrubAuthorizationLocation(appWindow);
  leave(appWindow, destination, "forward_request");
  return true;
}

/**
 * Sends a window whose entry holds no request to `/`, where identity management lives. The
 * parser-time script normally does this; this is its fallback.
 */
export function leaveEmptyAuthorizationEntry(appWindow: Window): void {
  leave(appWindow, "/", "leave_entry");
}

function leave(
  appWindow: Window,
  destination: string,
  operation: "forward_request" | "leave_entry",
): void {
  try {
    appWindow.stop();
  } catch {
    /* Loading may already have stopped. */
  }
  try {
    appWindow.location.replace(destination);
  } catch (e) {
    LOGGER.warn("authorize.entry.failed", {
      operation,
      code: "navigation_failed",
      ...safeErrorLogFields(e),
    });
  }
}

/** Removes authorization data, navigating away without it when native scrubbing fails. */
export function scrubAuthorizationLocation(
  appWindow: Window,
  options: { preserveSanitizedHistoryState?: boolean } = {},
): boolean {
  // Avoid framework-patched history methods while scrubbing before React commits.
  try {
    const HistoryConstructor = (appWindow as Window & { History: typeof History }).History;
    HistoryConstructor.prototype.replaceState.call(
      appWindow.history,
      options.preserveSanitizedHistoryState ? safeHistoryState(appWindow) : null,
      "",
      appWindow.location.pathname,
    );
    return true;
  } catch (e) {
    LOGGER.warn("authorize.entry.failed", {
      operation: "scrub_fragment",
      code: "history_unavailable",
      ...safeErrorLogFields(e),
    });
    try {
      appWindow.stop();
    } catch {
      /* Loading may already have stopped. */
    }
    try {
      appWindow.location.replace(appWindow.location.pathname);
    } catch {
      /* Clean navigation is best effort when both native location APIs fail. */
    }
    return false;
  }
}

function safeHistoryState(appWindow: Window): unknown {
  const state = appWindow.history.state as unknown;
  if (state === null) return null;

  try {
    const serialized = JSON.stringify(state);
    if (serialized === undefined || serialized.length > AUTHORIZATION_CAPTURE_MAX_CHARACTERS) {
      return null;
    }

    const containsCurrentFragment =
      appWindow.location.hash !== "" && serialized.includes(appWindow.location.hash);
    const containsCurrentQuery =
      appWindow.location.search !== "" && serialized.includes(appWindow.location.search);
    const containsAuthorizationData = /pubkyauth(?::|%3a)|(?:#|%23|\?|%3f)d(?:=|%3d)/iu.test(
      serialized,
    );
    if (containsCurrentFragment || containsCurrentQuery || containsAuthorizationData) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

/** Invalidates private approval metadata when an entry must be abandoned. */
export function invalidateAuthorizationEntry(
  entry: AuthorizationEntry,
): Extract<AuthorizationEntry, { status: "invalid" }> {
  if (entry.status === "valid") entry.request.release();
  return { status: "invalid", code: "history_unavailable" };
}
