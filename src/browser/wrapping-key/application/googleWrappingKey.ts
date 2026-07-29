import "client-only";

import type { Result } from "better-result";

export const GOOGLE_WRAPPING_KEY_API_ERROR_CODES = [
  "invalid_request",
  "invalid_google_id_token",
  "expired_google_id_token",
  "unsupported_google_issuer",
  "unsupported_google_audience",
  "missing_google_subject",
  "rate_limited",
  "dependency_unavailable",
  "internal_error",
] as const;

export type GoogleWrappingKeyErrorCode =
  | (typeof GOOGLE_WRAPPING_KEY_API_ERROR_CODES)[number]
  | "invalid_response"
  | "network_failed";

export type GoogleWrappingKeyResult = Result<string, { code: GoogleWrappingKeyErrorCode }>;
