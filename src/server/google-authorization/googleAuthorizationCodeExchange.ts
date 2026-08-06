import "server-only";

import { Buffer } from "node:buffer";
import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../libs/logger/logger";
import type { GoogleAccountProfile } from "../../core/identity/googleAccountProfile";

export type GoogleAuthorizationCredentials = { driveAccessToken: string; googleIdToken: string; googleAccount: GoogleAccountProfile };
export type GoogleAuthorizationCodeExchangeResult = ResultType<GoogleAuthorizationCredentials, { code: "authorization_failed" | "dependency_unavailable" }>;

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const MAXIMUM_TOKEN_RESPONSE_BYTES = 32 * 1024;
const MAXIMUM_AVATAR_BYTES = 256 * 1024;

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
    const googleAccount = await this.fetchGoogleAccount(body.access_token);
    if (Result.isError(googleAccount)) return Result.err(googleAccount.error);
    return Result.ok({ googleIdToken: body.id_token, driveAccessToken: body.access_token, googleAccount: googleAccount.value });
  }

  private async fetchGoogleAccount(accessToken: string): Promise<ResultType<GoogleAccountProfile, { code: "authorization_failed" | "dependency_unavailable" }>> {
    let response: Response;
    try {
      response = await this.#fetch(GOOGLE_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
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
    if (!isGoogleAccount(body)) return failure("authorization_failed");
    const pictureUrl = nonEmpty(body.picture)
      ? await this.fetchGoogleAvatar(body.picture, accessToken)
      : null;
    return Result.ok({ id: body.sub, email: body.email, name: body.name, pictureUrl });
  }

  private async fetchGoogleAvatar(url: string, accessToken: string): Promise<string | null> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".googleusercontent.com")) return null;

    try {
      const response = await this.#fetch(parsed, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type")?.split(";", 1)[0];
      if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_AVATAR_BYTES) return null;
      return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      return null;
    }
  }
}

function failure<T = GoogleAuthorizationCredentials>(code: "authorization_failed" | "dependency_unavailable"): ResultType<T, { code: "authorization_failed" | "dependency_unavailable" }> {
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

function isGoogleAccount(value: unknown): value is { sub: string; email: string; name: string; picture?: string } {
  return isRecord(value) && nonEmpty(value.sub) && nonEmpty(value.email) && nonEmpty(value.name)
    && (value.picture === undefined || nonEmpty(value.picture));
}
