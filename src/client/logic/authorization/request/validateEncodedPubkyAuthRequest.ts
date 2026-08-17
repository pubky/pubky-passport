import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  parseEncodedPubkyAuthRequest,
  type PubkyAuthParseError,
} from "./parseEncodedPubkyAuthRequest";

export type PubkyAuthValidationResult = ResultType<void, PubkyAuthParseError>;

/** Validates an encoded request without exposing its sensitive parsed value. */
export function validateEncodedPubkyAuthRequest(
  encodedRequest: unknown,
): PubkyAuthValidationResult {
  const parsed = parseEncodedPubkyAuthRequest(encodedRequest);
  return Result.isError(parsed) ? Result.err(parsed.error) : Result.ok();
}
