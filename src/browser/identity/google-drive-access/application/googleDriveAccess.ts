import "client-only";

import type { Result } from "better-result";

export type GoogleDriveAccessErrorCode =
  | "google_unavailable"
  | "google_drive_authorization_failed"
  | "google_drive_authorization_popup_closed"
  | "google_drive_authorization_popup_failed_to_open"
  | "google_drive_authorization_timeout"
  | "google_drive_authorization_aborted"
  | "google_drive_authorization_account_verification_failed"
  | "google_drive_authorization_account_mismatch";

export type GoogleDriveAccessResult<T> = Result<T, { code: GoogleDriveAccessErrorCode }>;

export type GoogleDriveAccessRequester = {
  request(input: {
    clientId: string;
    loginHint: string;
    expectedSubject: string;
    signal: AbortSignal;
  }): Promise<GoogleDriveAccessResult<string>>;
};
