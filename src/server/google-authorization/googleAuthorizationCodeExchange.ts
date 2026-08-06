import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../libs/logger/logger";

export type GoogleAuthorizationCredentials = { driveAccessToken: string; googleIdToken: string };
export type GoogleAuthorizationCodeExchangeResult = ResultType<GoogleAuthorizationCredentials, { code: "authorization_failed" | "dependency_unavailable" }>;

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const MAXIMUM_TOKEN_RESPONSE_BYTES = 32 * 1024;

export class GoogleAuthorizationCodeExchange {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #fetch: typeof fetch;

  constructor(input: { clientId: string; clientSecret: string; fetch?: typeof fetch }) {
    this.#clientId = input.clientId;
    this.#clientSecret = input.clientSecret;
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async exchange(code: string, redirectUri: string): Promise<GoogleAuthorizationCodeExchangeResult> {
    let response: Response;
    try {
      response = await this.#fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return failure("dependency_unavailable");
    }
    if (!response.ok) return failure(response.status >= 500 ? "dependency_unavailable" : "authorization_failed");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAXIMUM_TOKEN_RESPONSE_BYTES) return failure("authorization_failed");
    let body: unknown;
    try { body = JSON.parse(text); } catch { return failure("authorization_failed"); }
    if (!isRecord(body) || !nonEmpty(body.id_token) || !nonEmpty(body.access_token) || !hasScope(body.scope, GOOGLE_DRIVE_APP_DATA_SCOPE)) return failure("authorization_failed");
    return Result.ok({ googleIdToken: body.id_token, driveAccessToken: body.access_token });
  }
}

function failure(code: "authorization_failed" | "dependency_unavailable"): GoogleAuthorizationCodeExchangeResult {
  LOGGER.warn("identity.google.authorization_code.failed", { operation: "exchange", code });
  return Result.err({ code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasScope(value: unknown, expected: string): boolean {
  return typeof value === "string" && value.split(/\s+/u).includes(expected);
}
