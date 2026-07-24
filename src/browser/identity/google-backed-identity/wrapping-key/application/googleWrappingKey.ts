import "client-only";

import type { Result } from "better-result";

export type GoogleWrappingKeyRequesterErrorCode =
  | "invalid_request"
  | "invalid_google_id_token"
  | "expired_google_id_token"
  | "unsupported_google_issuer"
  | "unsupported_google_audience"
  | "missing_google_subject"
  | "rate_limited"
  | "dependency_unavailable"
  | "internal_error"
  | "invalid_response"
  | "network_failed";

export type GoogleWrappingKeyRequester = {
  requestWrappingKey(input: {
    googleIdToken: string;
  }): Promise<Result<string, { code: GoogleWrappingKeyRequesterErrorCode }>>;
};
