import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { LOGGER } from "../../../libs/logger/logger";
import { readBoundedText } from "../../../libs/http/boundedBody";
import { isCanonicalBase64Url } from "../../../libs/encoding/base64Url";

const GOOGLE_WRAPPING_KEY_API_ERROR_CODES = [
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

export class GoogleWrappingKeyApiClient {
  constructor(
    private fetch: typeof globalThis.fetch,
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
      LOGGER.warn("identity.google.wrapping_key.failed", {
        operation: "request_google_wrapping_key",
        stage: "request",
        code: "network_failed",
      });
      return Result.err({ code: "network_failed" });
    }

    const contents = await readBoundedText(response, MAXIMUM_RESPONSE_BYTES);
    if (contents === null || contents === "too_large") {
      LOGGER.warn("identity.google.wrapping_key.failed", {
        operation: "request_google_wrapping_key",
        stage: "response_read",
        code: "invalid_response",
      });
      return Result.err({ code: "invalid_response" });
    }

    let body: unknown;
    try {
      body = JSON.parse(contents);
    } catch {
      LOGGER.warn("identity.google.wrapping_key.failed", {
        operation: "request_google_wrapping_key",
        stage: "response_parse",
        code: "invalid_response",
      });
      return Result.err({ code: "invalid_response" });
    }

    if (!response.ok) {
      const parsed = ERROR_RESPONSE_SCHEMA.safeParse(body);
      const code = parsed.success ? parsed.data.error.code : "invalid_response";
      LOGGER.warn("identity.google.wrapping_key.failed", {
        operation: "request_google_wrapping_key",
        stage: "error_response",
        code,
      });
      return Result.err({ code });
    }

    const parsed = SUCCESS_RESPONSE_SCHEMA.safeParse(body);
    if (parsed.success) return Result.ok(parsed.data.wrappingKey);
    LOGGER.warn("identity.google.wrapping_key.failed", {
      operation: "request_google_wrapping_key",
      stage: "response_validation",
      code: "invalid_response",
    });
    return Result.err({ code: "invalid_response" });
  }
}
