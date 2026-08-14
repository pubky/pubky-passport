import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { LOGGER } from "../../../libs/logger/logger";
import { readBoundedText } from "../../../libs/http/boundedBody";
import { isCanonicalBase64Url } from "../../../libs/encoding/base64Url";

export const GOOGLE_WRAPPING_KEY_API_ERROR_CODES = [
  "invalid_request",
  "invalid_google_id_token",
  "rate_limited",
  "dependency_unavailable",
  "internal_error",
] as const;

export type GoogleWrappingKeyErrorCode =
  | (typeof GOOGLE_WRAPPING_KEY_API_ERROR_CODES)[number]
  | "invalid_response"
  | "network_failed";

export type GoogleWrappingKeyResult = Result<string, { code: GoogleWrappingKeyErrorCode }>;

const MAXIMUM_RESPONSE_BYTES = 16 * 1024;
const WRAPPING_KEY_BYTES = 32;
const WRAPPING_KEY_LENGTH = Math.ceil(WRAPPING_KEY_BYTES * 4 / 3);
const ROUTE_ERROR_CODE_SCHEMA = z.enum(GOOGLE_WRAPPING_KEY_API_ERROR_CODES);
const SUCCESS_RESPONSE_SCHEMA = z.object({
  wrappingKey: z.string().length(WRAPPING_KEY_LENGTH).refine(isCanonicalBase64Url),
}).strict();
const ERROR_RESPONSE_SCHEMA = z.object({
  error: z.object({ code: ROUTE_ERROR_CODE_SCHEMA }).strict(),
}).strict();

export class WrappingKeyApiClient {
  constructor(
    private fetch: typeof globalThis.fetch = (request, init) => globalThis.fetch(request, init),
  ) {}

  async requestGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyResult> {
    let response: Response;
    try {
      response = await this.fetch("/api/wrapping-key/google", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        // This endpoint intentionally receives only the Google ID token.
        body: JSON.stringify({ googleIdToken }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch {
      return failure("request", "network_failed");
    }

    const contents = await readBoundedText(response, MAXIMUM_RESPONSE_BYTES);
    if (contents === null || contents === "too_large") return failure("response_read", "invalid_response");

    let body: unknown;
    try {
      body = JSON.parse(contents);
    } catch {
      return failure("response_parse", "invalid_response");
    }

    if (!response.ok) {
      const parsed = ERROR_RESPONSE_SCHEMA.safeParse(body);
      return failure("error_response", parsed.success ? parsed.data.error.code : "invalid_response");
    }

    const parsed = SUCCESS_RESPONSE_SCHEMA.safeParse(body);
    return parsed.success ? Result.ok(parsed.data.wrappingKey) : failure("response_validation", "invalid_response");
  }
}

function failure(
  stage: "request" | "response_read" | "response_parse" | "error_response" | "response_validation",
  code: GoogleWrappingKeyErrorCode,
): GoogleWrappingKeyResult {
  LOGGER.warn("identity.google.wrapping_key.failed", {
    operation: "request_google_wrapping_key",
    stage,
    code,
  });
  return Result.err({ code });
}
