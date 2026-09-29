import type { PubkyErrorName } from "@synonymdev/pubky";

export type PassportErrorCode =
  | "popup_blocked"
  | "popup_closed"
  | "cancelled"
  | "passport_error"
  | "request_rejected"
  | "request_expired"
  | "timeout"
  | "network"
  | "identity_unresolved"
  | "approval_rejected"
  | "capability_mismatch"
  | "profile_required"
  | "resume_failed"
  | "unsupported_environment"
  | "internal";
export type PassportAction =
  | "sign-in"
  | "focus"
  | "reopen"
  | "cancel"
  | "continue-in-tab"
  | "retry"
  | "use-default-instance"
  | "reset-instance"
  | "create-profile";

export interface PassportErrorCause extends Error {
  readonly name: "PassportErrorCause";
  readonly message: PubkyErrorName | "UnknownError";
  readonly statusCode?: number;
}

export interface PassportError extends Error {
  readonly name: "PassportError";
  readonly code: PassportErrorCode;
  readonly devMessage: string;
  readonly retryable: boolean;
  readonly action?: PassportAction;
  readonly detail?: Readonly<{
    by?: "user" | "app";
    passportCode?: string;
    rejection?: string;
    sdkError?: PubkyErrorName;
    statusCode?: number;
    canContinueInTab?: boolean;
  }>;
  readonly cause?: PassportErrorCause;
}
