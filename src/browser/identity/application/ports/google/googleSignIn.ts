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

export type GoogleSignInCredential = {
  googleIdToken: string;
  subject: string;
};

export type GoogleSignInWidgetErrorCode = "google_unavailable" | "sign_in_failed";
export type GoogleSignInWidgetResult<T> = Result<T, { code: GoogleSignInWidgetErrorCode }>;

export type GoogleSignInWidget = {
  mount(input: {
    target: HTMLElement;
    onCredential: (result: GoogleSignInWidgetResult<GoogleSignInCredential>) => void;
  }): Promise<GoogleSignInWidgetResult<void>>;
  unmount(): void;
};
