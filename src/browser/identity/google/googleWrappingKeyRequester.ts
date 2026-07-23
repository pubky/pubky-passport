import "client-only";

import { Result } from "better-result";

import { readBoundedText } from "../../../libs/security/boundedBody";
import { logger } from "../../../libs/logger/logger";
import type {
  GoogleWrappingKeyRequester,
  GoogleWrappingKeyRequesterErrorCode,
} from "./applicationContracts";

const maximumResponseBytes = 16 * 1024;
const wrappingKeyBytes = 32;
const unpaddedBase64UrlPattern = /^[A-Za-z0-9_-]+$/;
const knownRouteErrorCodes = new Set<GoogleWrappingKeyRequesterErrorCode>([
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

export class BrowserGoogleWrappingKeyRequester implements GoogleWrappingKeyRequester {
  readonly #fetch: typeof fetch;
  readonly #origin: string;

  constructor(options: { fetch?: typeof fetch; origin?: string } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#origin = options.origin ?? globalThis.location?.origin ?? "";
  }

  async requestWrappingKey(input: { googleIdToken: string }) {
    let response: Response;
    try {
      const endpoint = this.#origin ? new URL("/api/wrapping-key/google", this.#origin) : "/api/wrapping-key/google";
      response = await this.#fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        // This endpoint intentionally receives only the Google ID token.
        body: JSON.stringify({ googleIdToken: input.googleIdToken }),
        credentials: "same-origin",
      });
    } catch (error) {
      logger.warn("identity.google.wrapping_key.network_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return failure("network_failed");
    }

    const contents = await readBoundedText(response, maximumResponseBytes);
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
  if (typeof value.wrappingKey !== "string" || !unpaddedBase64UrlPattern.test(value.wrappingKey)) return null;

  try {
    const standard = value.wrappingKey.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(`${standard}${"=".repeat((4 - standard.length % 4) % 4)}`);
    if (decoded.length !== wrappingKeyBytes) return null;
    const canonical = btoa(decoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    return canonical === value.wrappingKey ? value.wrappingKey : null;
  } catch {
    return null;
  }
}

function parseErrorCode(value: unknown): GoogleWrappingKeyRequesterErrorCode | null {
  if (!isExactRecord(value, ["error"]) || !isExactRecord(value.error, ["code"])) return null;
  if (typeof value.error.code !== "string") return null;
  return knownRouteErrorCodes.has(value.error.code as GoogleWrappingKeyRequesterErrorCode)
    ? value.error.code as GoogleWrappingKeyRequesterErrorCode
    : null;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function failure(code: GoogleWrappingKeyRequesterErrorCode) {
  return Result.err({ code });
}
