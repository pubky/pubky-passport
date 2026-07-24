import "client-only";

import type { Result } from "better-result";

export type GoogleIdentityServicesResult<T> = Result<T, { code: "google_unavailable" }>;

export type GoogleIdentityServicesLoader = {
  loadGoogleAccounts(): Promise<GoogleIdentityServicesResult<GoogleAccounts>>;
};

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
