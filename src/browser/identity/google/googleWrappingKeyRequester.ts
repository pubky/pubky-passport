import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleWrappingKeyRequester } from "./googleBackedIdentityFlow";
import { logger } from "../../../libs/logger/logger";

export class BrowserGoogleWrappingKeyRequester implements GoogleWrappingKeyRequester {
  readonly #fetch: typeof fetch;
  readonly #origin: string;

  constructor(options: { fetch?: typeof fetch; origin?: string } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#origin = options.origin ?? globalThis.location?.origin ?? "";
  }

  async requestWrappingKey(input: { googleIdToken: string }): Promise<ResultType<string, { code: string }>> {
    try {
      const endpoint = this.#origin ? new URL("/api/wrapping-key/google", this.#origin) : "/api/wrapping-key/google";
      const response = await this.#fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // This endpoint intentionally receives only the Google ID token.
        body: JSON.stringify({ googleIdToken: input.googleIdToken }),
        credentials: "same-origin",
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (isWrappingKeyErrorResponse(body)) return Result.err({ code: body.error.code });
      if (!response.ok) return Result.err({ code: `http_${response.status}` });
      if (!isWrappingKeyResponse(body)) return Result.err({ code: "invalid_response" });
      return Result.ok(body.wrappingKey);
    } catch (error) {
      logger.warn("identity.google.wrapping_key.network_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return Result.err({ code: "network_failed" });
    }
  }
}

function isWrappingKeyResponse(value: unknown): value is { wrappingKey: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { wrappingKey?: unknown }).wrappingKey === "string";
}

function isWrappingKeyErrorResponse(value: unknown): value is { error: { code: string } } {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = value.error;
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return typeof error.code === "string";
}
