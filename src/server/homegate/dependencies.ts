import "server-only";

import type { Result } from "better-result";

/**
 * The Homegate request flow owns this contract. Server code and test fakes
 * use it without introducing a cross-feature dependency registry.
 */
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

export type GoogleHomegateInviteResult = Result<HomeserverSignupInvitation, { code: GoogleHomegateInviteErrorCode }>;

export type GoogleHomegateInviteClient = {
  requestInvite(input: { googleIdToken: string }): Promise<GoogleHomegateInviteResult>;
};
