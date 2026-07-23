import "client-only";

import type { Result } from "better-result";

export type GoogleIdentityProviderErrorCode =
  | "google_unavailable"
  | "sign_in_failed"
  | "drive_consent_failed"
  | "drive_popup_closed"
  | "drive_popup_failed_to_open"
  | "drive_consent_timeout"
  | "drive_consent_aborted"
  | "drive_account_verification_failed"
  | "drive_account_mismatch";

export type GoogleIdentityProviderResult<T> = Result<T, { code: GoogleIdentityProviderErrorCode }>;

export type GoogleCredentialResponse = { credential?: unknown };
export type GoogleTokenResponse = { access_token?: unknown; error?: unknown; scope?: unknown };
export type GoogleOAuthError = { type?: unknown };

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
      login_hint?: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback: (error: GoogleOAuthError) => void;
    }): { requestAccessToken(input: { prompt: "" | "consent" | "select_account" }): void };
  };
};
