import "client-only";

import type { Result } from "better-result";

export type HomeserverSignupInvitation = {
  signupCode: string;
  homeserverPubky: string;
};

export type GoogleHomegateInvitationRequesterErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed";

export type GoogleHomegateInvitationRequester = {
  requestSignupInvitation(input: {
    googleIdToken: string;
  }): Promise<Result<HomeserverSignupInvitation, { code: GoogleHomegateInvitationRequesterErrorCode }>>;
};
