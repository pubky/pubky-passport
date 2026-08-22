import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { IssuedPubkyAuthRequest } from "../request/IssuedPubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "../request/pubkyAuthRequestLimits";

export type ManualAuthorizationInputResult = "invalid" | "navigation_failed" | "navigating";

/** Validates a pasted request and navigates without retaining or redisplaying it. */
export function submitManualAuthorizationInput(
  inputValue: string,
  replaceLocation: (url: string) => void = replaceAndReload,
): ManualAuthorizationInputResult {
  if (inputValue.length > PUBKY_AUTH_REQUEST_LIMITS.maximumDecodedAuthUrlCodeUnits) {
    logFailure("request_too_large");
    return "invalid";
  }

  const request = inputValue.trim();
  let encodedRequest: string;
  try {
    encodedRequest = encodeURIComponent(request);
  } catch {
    logFailure("invalid_encoding");
    return "invalid";
  }

  const validated = IssuedPubkyAuthRequest.validate(encodedRequest);
  if (Result.isError(validated)) {
    logFailure(validated.error.code);
    return "invalid";
  }

  try {
    replaceLocation(`/authorize#d=${encodedRequest}`);
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
