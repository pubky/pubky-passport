import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { LOGGER } from "../../../libs/logger/logger";
import { readBoundedText } from "../../../libs/http/boundedBody";
import { isCanonicalBase64Url } from "../../../libs/encoding/base64Url";
import {
  GOOGLE_WRAPPING_KEY_API_ERROR_CODES,
  type GoogleWrappingKeyErrorCode,
  type GoogleWrappingKeyResult,
} from "../application/googleWrappingKey";

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
  readonly #fetch: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async requestGoogleWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyResult> {
    let response: Response;
    try {
      response = await this.#fetch("/api/wrapping-key/google", {
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
      return failure("network_failed");
    }

    const contents = await readBoundedText(response, MAXIMUM_RESPONSE_BYTES);
    if (contents === null || contents === "too_large") return failure("invalid_response");

    let body: unknown;
    try {
      body = JSON.parse(contents);
    } catch {
      return failure("invalid_response");
    }

    if (!response.ok) {
      const parsed = ERROR_RESPONSE_SCHEMA.safeParse(body);
      return failure(parsed.success ? parsed.data.error.code : "invalid_response");
    }

    const parsed = SUCCESS_RESPONSE_SCHEMA.safeParse(body);
    return parsed.success ? Result.ok(parsed.data.wrappingKey) : failure("invalid_response");
  }
}

function failure(code: GoogleWrappingKeyErrorCode): GoogleWrappingKeyResult {
  LOGGER.warn("identity.google.wrapping_key.failed", { layer: "browser", code });
  return Result.err({ code });
}
