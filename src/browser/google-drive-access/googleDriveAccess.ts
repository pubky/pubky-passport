import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "../../libs/http/boundedBody";
import { LOGGER } from "../../libs/logger/logger";
import type { GoogleIdentityServices } from "../google-identity-services/googleIdentityServices";

export type GoogleDriveAccessErrorCode =
  | "google_unavailable"
  | "google_drive_authorization_failed"
  | "google_drive_authorization_popup_closed"
  | "google_drive_authorization_popup_failed_to_open"
  | "google_drive_authorization_timeout"
  | "google_drive_authorization_aborted"
  | "google_drive_authorization_account_verification_failed"
  | "google_drive_authorization_account_mismatch";

export type GoogleDriveAccessResult<T> = ResultType<T, { code: GoogleDriveAccessErrorCode }>;

export const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_OPEN_ID_SCOPE = "openid";
const GOOGLE_USER_INFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_CONSENT_TIMEOUT_MS = 60_000;
const MAXIMUM_USER_INFO_RESPONSE_BYTES = 16 * 1024;
const MAXIMUM_GOOGLE_SUBJECT_CHARACTERS = 255;
type GoogleSubjectVerification = "match" | "mismatch" | "unavailable" | "aborted";

export type GoogleDriveAccessOptions = {
  googleIdentityServices: GoogleIdentityServices;
  clientId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type GoogleDriveAccessRequest = {
  expectedSubject: string;
  selectAccount?: boolean;
  signal?: AbortSignal;
};

export class GoogleDriveAccess {
  readonly #googleIdentityServices: GoogleIdentityServices;
  readonly #clientId: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: GoogleDriveAccessOptions) {
    this.#googleIdentityServices = options.googleIdentityServices;
    this.#clientId = options.clientId;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DRIVE_CONSENT_TIMEOUT_MS;
  }

  async requestAccessToken(input: GoogleDriveAccessRequest): Promise<GoogleDriveAccessResult<string>> {
    if (input.signal?.aborted) return failure("request_start", "google_drive_authorization_aborted");
    LOGGER.info("identity.google.drive_authorization.started", { operation: "request_access_token" });
    let accounts: Awaited<ReturnType<GoogleIdentityServices["loadGoogleAccounts"]>>;
    try {
      accounts = await this.#googleIdentityServices.loadGoogleAccounts();
    } catch {
      return failure("services_load", "google_unavailable");
    }
    if (Result.isError(accounts)) return Result.err(accounts.error);
    if (input.signal?.aborted) return failure("services_loaded", "google_drive_authorization_aborted");

    return new Promise((resolve) => {
      let settled = false;
      const operationController = new AbortController();
      const finish = (result: GoogleDriveAccessResult<string>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = (): void => {
        operationController.abort();
        finish(failure("authorization", "google_drive_authorization_aborted"));
      };
      const timer = setTimeout(() => {
        operationController.abort();
        finish(failure("authorization", "google_drive_authorization_timeout"));
      }, Math.max(0, this.#timeoutMs));
      input.signal?.addEventListener("abort", abort, { once: true });

      try {
        const tokenClient = accounts.value.oauth2.initTokenClient({
          client_id: this.#clientId,
          scope: `${GOOGLE_OPEN_ID_SCOPE} ${GOOGLE_DRIVE_APP_DATA_SCOPE} ${GOOGLE_DRIVE_FILE_SCOPE}`,
          login_hint: input.expectedSubject,
          callback: async (response) => {
            if (settled) return;
            if (typeof response.access_token !== "string"
              || response.access_token.length === 0
              || response.error !== undefined
              || !hasGoogleScope(response.scope, GOOGLE_DRIVE_APP_DATA_SCOPE)) {
              finish(failure("oauth_response", "google_drive_authorization_failed"));
              return;
            }

            const verification = await verifyGoogleSubject(
              response.access_token,
              input.expectedSubject,
              this.#fetch,
              operationController.signal,
            );
            if (verification !== "match") {
              const code = verification === "mismatch"
                ? "google_drive_authorization_account_mismatch"
                : verification === "aborted"
                  ? "google_drive_authorization_aborted"
                  : "google_drive_authorization_account_verification_failed";
              finish(failure("account_verification", code));
              return;
            }

            LOGGER.info("identity.google.drive_authorization.completed", { operation: "request_access_token" });
            finish(Result.ok(response.access_token));
          },
          error_callback(error) {
            finish(failure(
              "oauth_popup",
              error.type === "popup_closed"
                ? "google_drive_authorization_popup_closed"
                : "google_drive_authorization_popup_failed_to_open",
            ));
          },
        });
        tokenClient.requestAccessToken({ prompt: input.selectAccount ? "select_account" : "" });
      } catch {
        finish(failure("oauth_client", "google_drive_authorization_popup_failed_to_open"));
      }
    });
  }
}

function failure(
  stage: "request_start" | "services_load" | "services_loaded" | "authorization" | "oauth_response" | "account_verification" | "oauth_popup" | "oauth_client",
  code: GoogleDriveAccessErrorCode,
): GoogleDriveAccessResult<never> {
  const expectedOutcome = code === "google_drive_authorization_aborted"
    || code === "google_drive_authorization_popup_closed"
    || code === "google_drive_authorization_account_mismatch";
  LOGGER[expectedOutcome ? "info" : "warn"]("identity.google.drive_authorization.failed", {
    operation: "request_access_token",
    stage,
    code,
  });
  return Result.err({ code });
}

async function verifyGoogleSubject(
  accessToken: string,
  expectedSubject: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<GoogleSubjectVerification> {
  try {
    const response = await fetchImpl(GOOGLE_USER_INFO_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!response.ok) return "unavailable";
    const contents = await readBoundedText(response, MAXIMUM_USER_INFO_RESPONSE_BYTES);
    if (contents === null || contents === "too_large") return "unavailable";

    let body: unknown;
    try {
      body = JSON.parse(contents);
    } catch {
      return "unavailable";
    }

    const subject = parseGoogleSubject(body);
    if (subject === null) return "unavailable";
    return subject === expectedSubject ? "match" : "mismatch";
  } catch {
    return signal.aborted ? "aborted" : "unavailable";
  }
}

function parseGoogleSubject(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "sub")) return null;
  const subject = (value as Record<string, unknown>).sub;
  return typeof subject === "string"
    && subject.length <= MAXIMUM_GOOGLE_SUBJECT_CHARACTERS
    && subject.trim().length > 0
    ? subject
    : null;
}

function hasGoogleScope(value: unknown, expectedScope: string): boolean {
  return typeof value === "string" && value.split(" ").includes(expectedScope);
}
