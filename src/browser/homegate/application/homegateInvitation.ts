import "client-only";

import type { Result } from "better-result";

export type HomeserverSignupInvitation = {
  signupCode: string;
  homeserverPubky: string;
};

export type HomegateInvitationErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed";

// Add a separate narrow interface for each future provider endpoint so consumers
// never depend on unrelated Homegate capabilities.
export interface GoogleSignupInvitationRequester {
  requestGoogleSignupInvitation(input: {
    googleIdToken: string;
  }): Promise<Result<HomeserverSignupInvitation, { code: HomegateInvitationErrorCode }>>;
}
