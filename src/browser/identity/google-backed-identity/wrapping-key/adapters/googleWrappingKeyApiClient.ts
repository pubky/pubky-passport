import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../../../libs/logger/logger";
import { readBoundedText } from "../../../../../libs/http/boundedBody";
import { isCanonicalBase64Url } from "../../../../../libs/encoding/base64Url";
import type {
  GoogleWrappingKeyErrorCode,
  GoogleWrappingKeyResult,
} from "../application/googleWrappingKey";

const MAXIMUM_RESPONSE_BYTES = 16 * 1024;
const WRAPPING_KEY_BYTES = 32;
const KNOWN_ROUTE_ERROR_CODES = new Set<GoogleWrappingKeyErrorCode>([
  "invalid_request",
  "invalid_google_id_token",
  "expired_google_id_token",
  "unsupported_google_issuer",
  "unsupported_google_audience",
  "missing_google_subject",
  "rate_limited",
  "dependency_unavailable",
  "internal_error",
]);

export class GoogleWrappingKeyApiClient {
  readonly #fetch: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async requestWrappingKey(googleIdToken: string): Promise<GoogleWrappingKeyResult> {
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
    } catch (error) {
      LOGGER.warn("identity.google.wrapping_key.network_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
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

    if (!response.ok) return failure(parseErrorCode(body) ?? "invalid_response");
    const wrappingKey = parseWrappingKey(body);
    return wrappingKey ? Result.ok(wrappingKey) : failure("invalid_response");
  }
}

function parseWrappingKey(value: unknown): string | null {
  if (!isExactRecord(value, ["wrappingKey"])) return null;
  if (typeof value.wrappingKey !== "string") return null;

  const expectedLength = Math.ceil(WRAPPING_KEY_BYTES * 4 / 3);
  return value.wrappingKey.length === expectedLength && isCanonicalBase64Url(value.wrappingKey)
    ? value.wrappingKey
    : null;
}

function parseErrorCode(value: unknown): GoogleWrappingKeyErrorCode | null {
  if (!isExactRecord(value, ["error"]) || !isExactRecord(value.error, ["code"])) return null;
  if (typeof value.error.code !== "string") return null;
  return KNOWN_ROUTE_ERROR_CODES.has(value.error.code as GoogleWrappingKeyErrorCode)
    ? value.error.code as GoogleWrappingKeyErrorCode
    : null;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function failure(code: GoogleWrappingKeyErrorCode): GoogleWrappingKeyResult {
  return Result.err({ code });
}
