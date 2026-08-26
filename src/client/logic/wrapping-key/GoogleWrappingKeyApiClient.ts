import "client-only";

import { Result } from "better-result";
import { LOGGER } from "../../../libs/logger/logger";
import { readBoundedText } from "../../../libs/http/boundedBody";
import type { CodedFailure } from "../../../libs/result";
import {
  GOOGLE_WRAPPING_KEY_ERROR_SCHEMA,
  type GoogleWrappingKeyApiErrorCode,
  GOOGLE_WRAPPING_KEY_SUCCESS_SCHEMA,
  type GoogleWrappingKey,
} from "../../../libs/googleWrappingKeyApi";

export type GoogleWrappingKeyErrorCode =
  | GoogleWrappingKeyApiErrorCode
  | "invalid_response"
  | "network_failed";

export type GoogleWrappingKeyResult = Result<GoogleWrappingKey, CodedFailure<GoogleWrappingKeyErrorCode>>;

const MAXIMUM_RESPONSE_BYTES = 16 * 1024;

export class GoogleWrappingKeyApiClient {
  constructor(private readonly fetch: typeof globalThis.fetch) {}

  async requestGoogleWrappingKey(
    googleIdToken: string,
    keyId?: string,
  ): Promise<GoogleWrappingKeyResult> {
    let response: Response;
    try {
      response = await this.fetch("/api/wrapping-key/google", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        // The optional key ID is public envelope metadata; Drive tokens never cross this boundary.
        body: JSON.stringify(keyId ? { googleIdToken, keyId } : { googleIdToken }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch (cause) {
      LOGGER.warn("identity.google.wrapping_key.failed", {
        operation: "request_google_wrapping_key",
        stage: "request",
        code: "network_failed",
      });
      return Result.err({ code: "network_failed", cause });
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
      const parsed = GOOGLE_WRAPPING_KEY_ERROR_SCHEMA.safeParse(body);
      const code = parsed.success ? parsed.data.error.code : "invalid_response";
      LOGGER.warn("identity.google.wrapping_key.failed", {
        operation: "request_google_wrapping_key",
        stage: "error_response",
        code,
      });
      return Result.err({ code });
    }

    const parsed = GOOGLE_WRAPPING_KEY_SUCCESS_SCHEMA.safeParse(body);
    if (parsed.success && (!keyId || parsed.data.keyId === keyId)) {
      return Result.ok(parsed.data);
    }
    LOGGER.warn("identity.google.wrapping_key.failed", {
      operation: "request_google_wrapping_key",
      stage: "response_validation",
      code: "invalid_response",
    });
    return Result.err({ code: "invalid_response" });
  }
}
