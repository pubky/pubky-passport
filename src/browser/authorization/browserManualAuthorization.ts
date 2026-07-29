import "client-only";

import { Result } from "better-result";

import { parsePubkyAuthRequest } from "../../core/auth/parsePubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "../../core/auth/pubkyAuthRequestLimits";

export type ManualAuthorizationEntryResult = "invalid" | "navigating";

export function enterAuthorization(
  rawRequest: string,
  navigate: (url: string) => void = (url) => window.location.replace(url),
): ManualAuthorizationEntryResult {
  if (rawRequest.length > PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength) {
    return "invalid";
  }

  const request = rawRequest.trim();
  let encodedRequest: string;
  try {
    encodedRequest = encodeURIComponent(request);
  } catch {
    return "invalid";
  }

  const parsed = parsePubkyAuthRequest(encodedRequest);
  if (Result.isError(parsed)) {
    return "invalid";
  }

  navigate(`/authorize?d=${encodedRequest}`);
  return "navigating";
}
