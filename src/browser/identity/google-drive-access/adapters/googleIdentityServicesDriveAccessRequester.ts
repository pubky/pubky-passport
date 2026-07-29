import "client-only";

import { Result } from "better-result";

import { readBoundedText } from "../../../../libs/http/boundedBody";
import type {
  GoogleAccounts,
  GoogleIdentityServicesLoader,
} from "../../google-identity-services/application/googleIdentityServices";
import type { GoogleDriveAccessRequester, GoogleDriveAccessResult } from "../application/googleDriveAccess";

export const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_OPEN_ID_SCOPE = "openid";
const GOOGLE_USER_INFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_CONSENT_TIMEOUT_MS = 60_000;
const MAXIMUM_USER_INFO_RESPONSE_BYTES = 16 * 1024;
const MAXIMUM_GOOGLE_SUBJECT_CHARACTERS = 255;
type GoogleSubjectVerification = "match" | "mismatch" | "unavailable" | "aborted";

export class GoogleIdentityServicesDriveAccessRequester implements GoogleDriveAccessRequester {
  readonly #fetch: typeof fetch;
  readonly #googleIdentityServices: GoogleIdentityServicesLoader;
  readonly #timeoutMs: number;

  constructor(options: { googleIdentityServices: GoogleIdentityServicesLoader; fetch?: typeof fetch; timeoutMs?: number }) {
    this.#googleIdentityServices = options.googleIdentityServices;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DRIVE_CONSENT_TIMEOUT_MS;
  }

  async request(input: {
    clientId: string;
    loginHint: string;
    expectedSubject: string;
    signal: AbortSignal;
  }): Promise<GoogleDriveAccessResult<string>> {
    return requestGoogleDriveAccessToken({
      ...input,
      googleIdentityServices: this.#googleIdentityServices,
      fetch: this.#fetch,
      timeoutMs: this.#timeoutMs,
    });
  }
}

export async function requestGoogleDriveAccessToken(input: {
  googleIdentityServices: GoogleIdentityServicesLoader;
  clientId: string;
  loginHint?: string;
  selectAccount?: boolean;
  expectedSubject?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<GoogleDriveAccessResult<string>> {
  if (input.signal?.aborted) return Result.err({ code: "google_drive_authorization_aborted" });
  let accounts: Awaited<ReturnType<GoogleIdentityServicesLoader["loadGoogleAccounts"]>>;
  try {
    accounts = await input.googleIdentityServices.loadGoogleAccounts();
  } catch {
    return Result.err({ code: "google_unavailable" });
  }
  if (Result.isError(accounts)) return Result.err(accounts.error);
  if (input.signal?.aborted) return Result.err({ code: "google_drive_authorization_aborted" });

  return requestDriveAccessToken(
    accounts.value,
    input.clientId,
    input.selectAccount === true,
    input.loginHint,
    input.expectedSubject,
    input.fetch ?? globalThis.fetch.bind(globalThis),
    input.signal,
    input.timeoutMs ?? DRIVE_CONSENT_TIMEOUT_MS,
  );
}

function requestDriveAccessToken(
  accounts: GoogleAccounts,
  clientId: string,
  selectAccount: boolean,
  loginHint: string | undefined,
  expectedSubject: string | undefined,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<GoogleDriveAccessResult<string>> {
  return new Promise((resolve) => {
    let settled = false;
    const operationController = new AbortController();
    const finish = (result: GoogleDriveAccessResult<string>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = (): void => {
      operationController.abort();
      finish(Result.err({ code: "google_drive_authorization_aborted" }));
    };
    const timer = setTimeout(() => {
      operationController.abort();
      finish(Result.err({ code: "google_drive_authorization_timeout" }));
    }, Math.max(0, timeoutMs));
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const tokenClient = accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: `${GOOGLE_OPEN_ID_SCOPE} ${GOOGLE_DRIVE_APP_DATA_SCOPE}`,
        ...(loginHint ? { login_hint: loginHint } : {}),
        async callback(response) {
          if (settled) return;
          if (typeof response.access_token !== "string" || response.access_token.length === 0 || response.error !== undefined || !hasGoogleScope(response.scope, GOOGLE_DRIVE_APP_DATA_SCOPE)) {
            finish(Result.err({ code: "google_drive_authorization_failed" }));
            return;
          }

          if (expectedSubject) {
            const verification = await verifyGoogleSubject(response.access_token, expectedSubject, fetchImpl, operationController.signal);
            if (verification !== "match") {
              const code = verification === "mismatch"
                ? "google_drive_authorization_account_mismatch"
                : verification === "aborted"
                  ? "google_drive_authorization_aborted"
                  : "google_drive_authorization_account_verification_failed";
              finish(Result.err({ code }));
              return;
            }
          }

          finish(Result.ok(response.access_token));
        },
        error_callback(error) {
          finish(Result.err({
            code: error.type === "popup_closed"
              ? "google_drive_authorization_popup_closed"
              : "google_drive_authorization_popup_failed_to_open",
          }));
        },
      });
      tokenClient.requestAccessToken({ prompt: selectAccount ? "select_account" : "" });
    } catch {
      finish(Result.err({ code: "google_drive_authorization_popup_failed_to_open" }));
    }
  });
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
