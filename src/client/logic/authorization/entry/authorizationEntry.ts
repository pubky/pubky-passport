import "client-only";

import { Result } from "better-result";

import {
  EARLY_AUTHORIZATION_LOCATION_PROPERTY,
  type EarlyAuthorizationLocation,
} from "@/libs/authorization/earlyAuthorizationLocation";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { AUTHORIZATION_CAPTURE_MAX_CHARACTERS } from "@/libs/passportPolicy";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "@/client/logic/authorization/request/parser/pubkyAuthRequestParser";

export type AuthorizationEntry =
  | {
      status: "valid";
      request: ValidatedPubkyAuthRequest;
    }
  | { status: "empty" }
  | { status: "expired" }
  | { status: "invalid" };

/**
 * Consumes the early authorization capture, scrubs the address bar, and returns
 * only a safe entry state for controller construction.
 */
export function readAndScrubAuthorizationEntry(appWindow: Window): AuthorizationEntry {
  const earlyLocation = takeEarlyAuthorizationLocation(appWindow);
  const rawSearch = earlyLocation?.status === "captured" ? "" : appWindow.location.search;
  const rawHash =
    earlyLocation?.status === "captured" ? earlyLocation.hash : appWindow.location.hash;
  if (!scrubAuthorizationLocation(appWindow)) return { status: "invalid" };

  if (earlyLocation?.status === "expired") {
    return { status: "expired" };
  }

  if (earlyLocation?.status === "too_large" || earlyLocation?.status === "invalid_search") {
    return { status: "invalid" };
  }

  if (earlyLocation?.status === "captured" && Date.now() >= earlyLocation.expiresAt) {
    return { status: "expired" };
  }

  if (rawSearch.length === 0 && rawHash.length === 0) {
    return { status: "empty" };
  }

  const rawD =
    rawSearch.length === 0 ? extractAuthorizationFragmentValue(rawHash) : { valid: false as const };
  const validated = ValidatedPubkyAuthRequest.fromEncoded(rawD.valid ? rawD.value : undefined);
  if (Result.isError(validated)) {
    LOGGER.info("authorize.parse.failed", {
      source: "fragment",
      code: rawD.valid ? validated.error.code : "invalid_fragment_shape",
    });
  }
  return Result.isError(validated)
    ? { status: "invalid" }
    : {
        status: "valid",
        request: validated.value,
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

function extractAuthorizationFragmentValue(
  hash: string,
): { valid: true; value?: string } | { valid: false } {
  if (hash.length > PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits + "#d=".length) {
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
export function invalidateAuthorizationEntry(entry: AuthorizationEntry): AuthorizationEntry {
  if (entry.status === "valid") entry.request.release();
  return { status: "invalid" };
}
