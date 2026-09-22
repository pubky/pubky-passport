import "client-only";

import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import {
  PUBKY_AUTH_REQUEST_LIMITS,
  validateEncodedPubkyAuthRequest,
} from "@/client/logic/authorization/request/parser/pubkyAuthRequestParser";

export type ManualAuthorizationInputValidationResult =
  { status: "invalid" } | { status: "valid"; destination: string };

/** Validates a pasted request and returns its browser-entry destination. */
export function validateManualAuthorizationInput(
  inputValue: string,
): ManualAuthorizationInputValidationResult {
  if (inputValue.length > PUBKY_AUTH_REQUEST_LIMITS.maximumDecodedAuthUrlCodeUnits) {
    logFailure("request_too_large");
    return { status: "invalid" };
  }

  const request = inputValue.trim();
  let encodedRequest: string;
  try {
    encodedRequest = encodeURIComponent(request);
  } catch {
    logFailure("invalid_encoding");
    return { status: "invalid" };
  }

  const validated = validateEncodedPubkyAuthRequest(encodedRequest);
  if (Result.isError(validated)) {
    logFailure(validated.error.code);
    return { status: "invalid" };
  }

  return { status: "valid", destination: `/authorize#d=${encodedRequest}` };
}

function logFailure(code: string): void {
  LOGGER.info("authorize.manual_entry.failed", {
    operation: "enter_authorization",
    code,
  });
}
