import "client-only";

import { Result } from "better-result";

import { validatePubkyAuthRequest } from "./parsePubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";
import { LOGGER } from "../../../libs/logger/logger";

export type ManualAuthorizationEntryResult = "invalid" | "navigation_failed" | "navigating";

/** Validates a pasted request and navigates without retaining or redisplaying it. */
export function enterAuthorization(
  rawRequest: string,
  navigate: (url: string) => void = replaceAndReload,
): ManualAuthorizationEntryResult {
  if (rawRequest.length > PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength) {
    logFailure("request_too_large");
    return "invalid";
  }

  const request = rawRequest.trim();
  let encodedRequest: string;
  try {
    encodedRequest = encodeURIComponent(request);
  } catch {
    logFailure("invalid_encoding");
    return "invalid";
  }

  const validated = validatePubkyAuthRequest(encodedRequest);
  if (Result.isError(validated)) {
    logFailure(validated.error.code);
    return "invalid";
  }

  try {
    navigate(`/authorize#d=${encodedRequest}`);
  } catch {
    logFailure("navigation_failed");
    return "navigation_failed";
  }
  return "navigating";
}

function replaceAndReload(url: string): void {
  History.prototype.replaceState.call(window.history, null, "", url);
  window.location.reload();
}

function logFailure(code: string): void {
  LOGGER.info("authorize.manual_entry.failed", {
    operation: "enter_authorization",
    code,
  });
}
