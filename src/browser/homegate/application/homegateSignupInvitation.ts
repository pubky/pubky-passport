import "client-only";

export type HomeserverSignupInvitation = {
  signupCode: string;
  homeserverPubky: string;
};

export type HomegateSignupInvitationErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed";
