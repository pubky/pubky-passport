import "client-only";

import { Result } from "better-result";

import type { GoogleIdentityProviderResult } from "./applicationContracts";
import type {
  GoogleAccounts,
  GoogleCredentialResponse,
} from "./googleIdentityProviderTypes";

declare global {
  interface Window {
    google?: { accounts?: GoogleAccounts };
  }
}

const googleGisScriptUrl = "https://accounts.google.com/gsi/client";
export const googleDriveAppDataScope = "https://www.googleapis.com/auth/drive.appdata";
const googleOpenIdScope = "openid";
const googleUserInfoUrl = "https://openidconnect.googleapis.com/v1/userinfo";
const gisScriptLoadTimeoutMs = 10_000;
const driveConsentTimeoutMs = 60_000;
const gisLoadStateAttribute = "data-pubky-passport-load-state";
type GoogleSubjectVerification = "match" | "mismatch" | "unavailable" | "aborted";
let gisScriptLoadPromise: Promise<void> | undefined;
let initializedIdentityAccounts: GoogleAccounts | undefined;
let initializedIdentityClientId: string | undefined;
let activeCredentialCallback: ((response: GoogleCredentialResponse) => void) | undefined;

export async function loadGoogleAccounts(
  document: Document = globalThis.document,
  timeoutMs = gisScriptLoadTimeoutMs,
): Promise<GoogleIdentityProviderResult<GoogleAccounts>> {
  const existing = globalThis.window.google?.accounts;
  if (existing) return Result.ok(existing);

  try {
    await loadGisScript(document, timeoutMs);
  } catch {
    return Result.err({ code: "google_unavailable" });
  }

  const accounts = globalThis.window.google?.accounts;
  if (!accounts) gisScriptLoadPromise = undefined;
  return accounts ? Result.ok(accounts) : Result.err({ code: "google_unavailable" });
}

export async function requestGoogleDriveAccess(input: {
  clientId: string;
  loginHint?: string;
  selectAccount?: boolean;
  expectedSubject?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<GoogleIdentityProviderResult<string>> {
  if (input.signal?.aborted) return Result.err({ code: "drive_consent_aborted" });
  const accounts = await loadGoogleAccounts();
  if (Result.isError(accounts)) return Result.err(accounts.error);
  if (input.signal?.aborted) return Result.err({ code: "drive_consent_aborted" });

  return requestDriveAccessToken(
    accounts.value,
    input.clientId,
    input.selectAccount === true,
    input.loginHint,
    input.expectedSubject,
    input.fetch ?? globalThis.fetch.bind(globalThis),
    input.signal,
    input.timeoutMs ?? driveConsentTimeoutMs,
  );
}

export function bindGoogleCredentialCallback(input: {
  accounts: GoogleAccounts;
  clientId: string;
  callback: (response: GoogleCredentialResponse) => void;
}): GoogleIdentityProviderResult<void> {
  if (activeCredentialCallback && activeCredentialCallback !== input.callback) {
    return Result.err({ code: "sign_in_failed" });
  }

  if (initializedIdentityAccounts === input.accounts) {
    if (initializedIdentityClientId !== input.clientId) {
      return Result.err({ code: "sign_in_failed" });
    }

    activeCredentialCallback = input.callback;
    return Result.ok();
  }

  if (activeCredentialCallback) {
    return Result.err({ code: "sign_in_failed" });
  }

  activeCredentialCallback = input.callback;
  try {
    input.accounts.id.initialize({
      client_id: input.clientId,
      auto_select: false,
      callback(response) {
        activeCredentialCallback?.(response);
      },
    });
    initializedIdentityAccounts = input.accounts;
    initializedIdentityClientId = input.clientId;
    return Result.ok();
  } catch {
    if (activeCredentialCallback === input.callback) activeCredentialCallback = undefined;
    return Result.err({ code: "sign_in_failed" });
  }
}

export function releaseGoogleCredentialCallback(
  callback: (response: GoogleCredentialResponse) => void,
): void {
  if (activeCredentialCallback === callback) activeCredentialCallback = undefined;
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
): Promise<GoogleIdentityProviderResult<string>> {
  return new Promise((resolve) => {
    let settled = false;
    const operationController = new AbortController();
    const finish = (result: GoogleIdentityProviderResult<string>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = (): void => {
      operationController.abort();
      finish(Result.err({ code: "drive_consent_aborted" }));
    };
    const timer = setTimeout(() => {
      operationController.abort();
      finish(Result.err({ code: "drive_consent_timeout" }));
    }, Math.max(0, timeoutMs));
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const tokenClient = accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: `${googleOpenIdScope} ${googleDriveAppDataScope}`,
        ...(loginHint ? { login_hint: loginHint } : {}),
        async callback(response) {
          if (settled) return;
          if (typeof response.access_token !== "string" || response.access_token.length === 0 || response.error !== undefined || !hasGoogleScope(response.scope, googleDriveAppDataScope)) {
            finish(Result.err({ code: "drive_consent_failed" }));
            return;
          }

          if (expectedSubject) {
            const verification = await verifyGoogleSubject(response.access_token, expectedSubject, fetchImpl, operationController.signal);
            if (verification !== "match") {
              const code = verification === "mismatch"
                ? "drive_account_mismatch"
                : verification === "aborted"
                  ? "drive_consent_aborted"
                  : "drive_account_verification_failed";
              finish(Result.err({ code }));
              return;
            }
          }

          finish(Result.ok(response.access_token));
        },
        error_callback(error) {
          finish(Result.err({ code: error.type === "popup_closed" ? "drive_popup_closed" : "drive_popup_failed_to_open" }));
        },
      });
      tokenClient.requestAccessToken({ prompt: selectAccount ? "select_account" : "" });
    } catch {
      finish(Result.err({ code: "drive_popup_failed_to_open" }));
    }
  });
}

async function verifyGoogleSubject(accessToken: string, expectedSubject: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<GoogleSubjectVerification> {
  try {
    const response = await fetchImpl(googleUserInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("sub" in body) || typeof body.sub !== "string" || body.sub.length === 0) return "unavailable";
    return body.sub === expectedSubject ? "match" : "mismatch";
  } catch {
    return signal.aborted ? "aborted" : "unavailable";
  }
}

export function googleIdTokenSubject(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;

  try {
    const json = globalThis.atob(payload.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && "sub" in value && typeof value.sub === "string" ? value.sub : undefined;
  } catch {
    return undefined;
  }
}

export function hasGoogleScope(value: unknown, expectedScope: string): boolean {
  return typeof value === "string" && value.split(" ").includes(expectedScope);
}

function loadGisScript(document: Document, timeoutMs: number): Promise<void> {
  if (gisScriptLoadPromise) return gisScriptLoadPromise;

  const existing = document.querySelector(`script[src="${googleGisScriptUrl}"]`);
  const existingReadyState = (existing as (Element & { readyState?: string }) | null)?.readyState;
  if (existing?.getAttribute(gisLoadStateAttribute) === "loaded" || existingReadyState === "loaded" || existingReadyState === "complete") {
    return Promise.resolve();
  }

  const script = existing ?? document.createElement("script");
  if (!existing) {
    script.setAttribute("src", googleGisScriptUrl);
    script.setAttribute("async", "");
    script.setAttribute(gisLoadStateAttribute, "loading");
  }

  const loading = new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
    const loaded = (): void => {
      script.setAttribute(gisLoadStateAttribute, "loaded");
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      script.remove();
      reject(new Error("GIS load failed"));
    };
    const timer = setTimeout(failed, Math.max(0, timeoutMs));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) document.head.append(script);
  });

  const shared = loading.finally(() => {
    if (gisScriptLoadPromise === shared) gisScriptLoadPromise = undefined;
  });
  gisScriptLoadPromise = shared;
  return shared;
}
