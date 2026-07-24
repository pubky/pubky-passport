import "client-only";

import type { Result } from "better-result";

export type GoogleDriveAccessErrorCode =
  | "google_unavailable"
  | "drive_consent_failed"
  | "drive_popup_closed"
  | "drive_popup_failed_to_open"
  | "drive_consent_timeout"
  | "drive_consent_aborted"
  | "drive_account_verification_failed"
  | "drive_account_mismatch";

export type GoogleDriveAccessResult<T> = Result<T, { code: GoogleDriveAccessErrorCode }>;

export type GoogleDriveAccessRequester = {
  request(input: {
    clientId: string;
    loginHint: string;
    expectedSubject: string;
    signal: AbortSignal;
  }): Promise<GoogleDriveAccessResult<string>>;
};
