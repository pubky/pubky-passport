import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../libs/logger/logger";
import type { GoogleBackedIdentityCredentials } from "../identity/google-backed/googleBackedIdentityCredentials";
import type { GoogleAccounts, GoogleIdentityServices } from "../google-identity-services/googleIdentityServices";

export type GoogleAuthorizationCodeErrorCode = "google_authorization_failed" | "google_authorization_popup_closed" | "google_authorization_popup_failed_to_open";
export type GoogleAuthorizationCodeResult<T> = ResultType<T, { code: GoogleAuthorizationCodeErrorCode }>;

type InitCodeClient = NonNullable<GoogleAccounts["oauth2"]["initCodeClient"]>;
type AuthorizationAttempt = {
  abortController: AbortController;
  resolve: (result: GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>) => void;
};

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
  #initCodeClient: InitCodeClient | null = null;
  #activeAttempt: AuthorizationAttempt | null = null;
  #preparationGeneration = 0;

  constructor(input: { clientId: string; googleIdentityServices: GoogleIdentityServices; fetch?: typeof fetch }) {
    this.#clientId = input.clientId;
    this.#googleIdentityServices = input.googleIdentityServices;
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async prepare(): Promise<GoogleAuthorizationCodeResult<void>> {
    if (this.#initCodeClient) return Result.ok();
    const preparationGeneration = ++this.#preparationGeneration;
    const accounts = await this.#googleIdentityServices.loadGoogleAccounts();
    if (Result.isError(accounts)) return failure("prepare", "google_authorization_failed");
    const initCodeClient = accounts.value.oauth2.initCodeClient;
    if (!initCodeClient) return failure("prepare", "google_authorization_failed");
    if (preparationGeneration !== this.#preparationGeneration) {
      return Result.err({ code: "google_authorization_failed" });
    }
    this.#initCodeClient = initCodeClient.bind(accounts.value.oauth2);
    return Result.ok();
  }

  request(loginHint?: string): Promise<GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>> {
    const initCodeClient = this.#initCodeClient;
    if (!initCodeClient || this.#activeAttempt) {
      return Promise.resolve(failure("request", "google_authorization_failed"));
    }
    return new Promise((resolve) => {
      const attempt: AuthorizationAttempt = { abortController: new AbortController(), resolve };
      this.#activeAttempt = attempt;
      let client: { requestCode(): void };
      try {
        client = initCodeClient({
          client_id: this.#clientId,
          scope: GOOGLE_AUTHORIZATION_SCOPE,
          ...(loginHint ? { login_hint: loginHint } : {}),
          ux_mode: "popup",
          callback: (response) => { void this.handleCode(attempt, response); },
          error_callback: (error) => this.finish(attempt, Result.err({ code: error.type === "popup_closed" ? "google_authorization_popup_closed" : "google_authorization_popup_failed_to_open" })),
        });
      } catch {
        this.finish(attempt, failure("initialize", "google_authorization_failed"));
        return;
      }
      try { client.requestCode(); }
      catch { this.finish(attempt, failure("popup", "google_authorization_popup_failed_to_open")); }
    });
  }

  dispose(): void {
    this.#preparationGeneration += 1;
    const attempt = this.#activeAttempt;
    if (attempt) this.finish(attempt, Result.err({ code: "google_authorization_failed" }));
    this.#initCodeClient = null;
  }

  private async handleCode(attempt: AuthorizationAttempt, response: { code?: unknown; error?: unknown }): Promise<void> {
    if (this.#activeAttempt !== attempt) return;
    if (typeof response.code !== "string" || response.code.length === 0 || response.error !== undefined) {
      this.finish(attempt, failure("response", "google_authorization_failed"));
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
        signal: attempt.abortController.signal,
      });
    } catch {
      if (this.#activeAttempt !== attempt) return;
      this.finish(attempt, failure("exchange", "google_authorization_failed"));
      return;
    }
    if (this.#activeAttempt !== attempt) return;
    let body: unknown;
    try { body = await exchanged.json(); } catch {
      if (this.#activeAttempt === attempt) this.finish(attempt, failure("exchange", "google_authorization_failed"));
      return;
    }
    if (this.#activeAttempt !== attempt) return;
    if (!exchanged.ok || !isCredentials(body)) {
      this.finish(attempt, failure("exchange", "google_authorization_failed"));
      return;
    }
    this.finish(attempt, Result.ok(body));
  }

  private finish(attempt: AuthorizationAttempt, result: GoogleAuthorizationCodeResult<GoogleBackedIdentityCredentials>): void {
    if (this.#activeAttempt !== attempt) return;
    attempt.abortController.abort();
    this.#activeAttempt = null;
    attempt.resolve(result);
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
