import type { Result } from "better-result";

export type HomeserverSignupInvitation = {
  signupCode: string;
  homeserverPubky: string;
};

export type GoogleHomegateInviteErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response";

export type GoogleHomegateInviteError = {
  code: GoogleHomegateInviteErrorCode;
};

export type GoogleHomegateInviteResult = Result<HomeserverSignupInvitation, GoogleHomegateInviteError>;

export type GoogleHomegateInviteRequest = {
  googleIdToken: string;
};

export interface GoogleHomegateInvitePort {
  requestInvite(input: GoogleHomegateInviteRequest): Promise<GoogleHomegateInviteResult>;
}
