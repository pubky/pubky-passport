import "client-only";

import { Result, type Result as ResultType } from "better-result";

export type GoogleIdentitySession = {
  googleIdToken: string;
  driveAccessToken: string;
};

export type GoogleIdentityProviderErrorCode = "google_unavailable" | "sign_in_failed" | "drive_consent_failed" | "drive_account_mismatch";
export type GoogleIdentityProviderResult<T> = ResultType<T, { code: GoogleIdentityProviderErrorCode }>;

export type GoogleCredentialResponse = { credential?: unknown };
type GoogleTokenResponse = { access_token?: unknown; error?: unknown; scope?: unknown };
export type GoogleAccounts = {
  id: {
    initialize(config: { client_id: string; callback: (response: GoogleCredentialResponse) => void; auto_select: boolean }): void;
    renderButton(parent: HTMLElement, config: { theme: "outline"; size: "large"; text: "continue_with" | "signin_with" }): void;
    disableAutoSelect?(): void;
  };
  oauth2: {
    initTokenClient(config: {
      client_id: string;
      scope: string;
      hint?: string;
      callback: (response: GoogleTokenResponse) => void;
    }): { requestAccessToken(input: { prompt: "" | "consent" | "select_account" }): void };
  };
};

declare global {
  interface Window {
    google?: { accounts?: GoogleAccounts };
  }
}

const googleGisScriptUrl = "https://accounts.google.com/gsi/client";
export const googleDriveAppDataScope = "https://www.googleapis.com/auth/drive.appdata";
const googleOpenIdScope = "openid";
const googleUserInfoUrl = "https://openidconnect.googleapis.com/v1/userinfo";

export async function loadGoogleAccounts(document: Document = globalThis.document): Promise<GoogleIdentityProviderResult<GoogleAccounts>> {
  const existing = globalThis.window.google?.accounts;
  if (existing) return Result.ok(existing);

  try {
    await loadGisScript(document);
  } catch {
    return Result.err({ code: "google_unavailable" });
  }

  const accounts = globalThis.window.google?.accounts;
  return accounts ? Result.ok(accounts) : Result.err({ code: "google_unavailable" });
}

export async function requestGoogleDriveAccess(input: {
  clientId: string;
  hint?: string;
  selectAccount?: boolean;
  expectedSubject?: string;
  fetch?: typeof fetch;
}): Promise<GoogleIdentityProviderResult<string>> {
  const accounts = await loadGoogleAccounts();
  if (Result.isError(accounts)) return Result.err(accounts.error);

  return requestDriveAccessToken(
    accounts.value,
    input.clientId,
    input.selectAccount === true,
    input.hint,
    input.expectedSubject,
    input.fetch ?? globalThis.fetch.bind(globalThis),
  );
}

function requestDriveAccessToken(
  accounts: GoogleAccounts,
  clientId: string,
  selectAccount: boolean,
  hint: string | undefined,
  expectedSubject: string | undefined,
  fetchImpl: typeof fetch,
): Promise<GoogleIdentityProviderResult<string>> {
  return new Promise((resolve) => {
    const tokenClient = accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: `${googleOpenIdScope} ${googleDriveAppDataScope}`,
      ...(hint ? { hint } : {}),
      async callback(response) {
        if (typeof response.access_token !== "string" || response.access_token.length === 0 || response.error !== undefined || !hasGoogleScope(response.scope, googleDriveAppDataScope)) {
          resolve(Result.err({ code: "drive_consent_failed" }));
          return;
        }

        if (expectedSubject && !await hasExpectedGoogleSubject(response.access_token, expectedSubject, fetchImpl)) {
          resolve(Result.err({ code: "drive_account_mismatch" }));
          return;
        }

        resolve(Result.ok(response.access_token));
      },
    });
    tokenClient.requestAccessToken({ prompt: selectAccount ? "select_account" : "" });
  });
}

async function hasExpectedGoogleSubject(accessToken: string, expectedSubject: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(googleUserInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== "object" || !("sub" in body)) return false;
    return body.sub === expectedSubject;
  } catch {
    return false;
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

export function clearGoogleAuthorization(): void {
  globalThis.window.google?.accounts?.id.disableAutoSelect?.();
}

function loadGisScript(document: Document): Promise<void> {
  const existing = document.querySelector(`script[src="${googleGisScriptUrl}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("GIS load failed")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = googleGisScriptUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("GIS load failed"));
    };
    document.head.append(script);
  });
}
