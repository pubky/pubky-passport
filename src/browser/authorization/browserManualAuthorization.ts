import "client-only";

import { Result } from "better-result";

import { parsePubkyAuthRequest } from "../../core/auth/parsePubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "../../core/auth/pubkyAuthRequestLimits";
import { LOGGER } from "../../libs/logger/logger";

export type ManualAuthorizationEntryResult = "invalid" | "navigation_failed" | "navigating";

export function enterAuthorization(
  rawRequest: string,
  navigate: (url: string) => void = (url) => window.location.replace(url),
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

  const parsed = parsePubkyAuthRequest(encodedRequest);
  if (Result.isError(parsed)) {
    logFailure(parsed.error.code);
    return "invalid";
  }

  try {
    navigate(`/authorize?d=${encodedRequest}`);
  } catch {
    logFailure("navigation_failed");
    return "navigation_failed";
  }
  return "navigating";
}

function logFailure(code: string): void {
  LOGGER.info("authorize.manual_entry.failed", {
    operation: "enter_authorization",
    code,
  });
}
