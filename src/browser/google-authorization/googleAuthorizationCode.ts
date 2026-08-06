import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../libs/logger/logger";
import type { GoogleBackedIdentityCredentials } from "../identity/google-backed/googleBackedIdentityCredentials";
import type { GoogleIdentityServices } from "../google-identity-services/googleIdentityServices";

export type GoogleAuthorizationCodeErrorCode = "google_authorization_failed" | "google_authorization_popup_closed" | "google_authorization_popup_failed_to_open" | "google_authorization_timeout";
export type GoogleAuthorizationCodeResult<T> = ResultType<T, { code: GoogleAuthorizationCodeErrorCode }>;

const GOOGLE_AUTHORIZATION_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

export class GoogleAuthorizationCode {
  readonly #clientId: string;
  readonly #googleIdentityServices: GoogleIdentityServices;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  #client: { requestCode(): void } | null = null;
  #pending: ((result: GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>) => void) | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(input: { clientId: string; googleIdentityServices: GoogleIdentityServices; fetch?: typeof fetch; timeoutMs?: number }) {
    this.#clientId = input.clientId;
    this.#googleIdentityServices = input.googleIdentityServices;
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = input.timeoutMs ?? 60_000;
  }

  async prepare(): Promise<GoogleAuthorizationCodeResult<void>> {
    if (this.#client) return Result.ok();
    const accounts = await this.#googleIdentityServices.loadGoogleAccounts();
    if (Result.isError(accounts)) return failure("prepare", "google_authorization_failed");
    if (!accounts.value.oauth2.initCodeClient) return failure("prepare", "google_authorization_failed");
    try {
      this.#client = accounts.value.oauth2.initCodeClient({
        client_id: this.#clientId,
        scope: GOOGLE_AUTHORIZATION_SCOPE,
        ux_mode: "popup",
        callback: (response) => { void this.handleCode(response); },
        error_callback: (error) => this.finish(Result.err({ code: error.type === "popup_closed" ? "google_authorization_popup_closed" : "google_authorization_popup_failed_to_open" })),
      });
      return Result.ok();
    } catch {
      return failure("prepare", "google_authorization_failed");
    }
  }

  request(): Promise<GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>> {
    if (!this.#client || this.#pending) return Promise.resolve(failure("request", "google_authorization_failed"));
    return new Promise((resolve) => {
      this.#pending = resolve;
      this.#timer = setTimeout(() => this.finish(failure("timeout", "google_authorization_timeout")), this.#timeoutMs);
      try { this.#client?.requestCode(); }
      catch { this.finish(failure("popup", "google_authorization_popup_failed_to_open")); }
    });
  }

  dispose(): void {
    this.finish(Result.err({ code: "google_authorization_failed" }));
    this.#client = null;
  }

  private async handleCode(response: { code?: unknown; error?: unknown }): Promise<void> {
    if (!this.#pending) return;
    if (typeof response.code !== "string" || response.code.length === 0 || response.error !== undefined) {
      this.finish(failure("response", "google_authorization_failed"));
      return;
    }
    let exchanged: Response;
    try {
      exchanged = await this.#fetch("/api/google/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XmlHttpRequest" },
        body: JSON.stringify({ code: response.code }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
    } catch {
      this.finish(failure("exchange", "google_authorization_failed"));
      return;
    }
    let body: unknown;
    try { body = await exchanged.json(); } catch { this.finish(failure("exchange", "google_authorization_failed")); return; }
    if (!exchanged.ok || !isCredentials(body)) {
      this.finish(failure("exchange", "google_authorization_failed"));
      return;
    }
    this.finish(Result.ok(body));
  }

  private finish(result: GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const pending = this.#pending;
    this.#pending = null;
    pending?.(result);
  }
}

function failure(stage: string, code: GoogleAuthorizationCodeErrorCode): GoogleAuthorizationCodeResult<never> {
  LOGGER.warn("identity.google.authorization_code.failed", { operation: "authorize", stage, code });
  return Result.err({ code });
}

function isCredentials(value: unknown): value is GoogleBackedIdentityCredentials {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).googleIdToken === "string"
    && typeof (value as Record<string, unknown>).driveAccessToken === "string"
    && isGoogleAccount((value as Record<string, unknown>).googleAccount);
}

function isGoogleAccount(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  return typeof account.id === "string" && account.id.length > 0
    && typeof account.email === "string" && account.email.length > 0
    && typeof account.name === "string" && account.name.length > 0
    && (account.pictureUrl === null || typeof account.pictureUrl === "string");
}
