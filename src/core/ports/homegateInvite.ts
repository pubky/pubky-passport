export type GoogleHomegateInvite = {
  signupCode: string;
  homeserverPubky: string;
};

export type HomegateInviteErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response";

export type HomegateInviteError = {
  code: HomegateInviteErrorCode;
};

export type HomegateInviteResult =
  | { ok: true; value: GoogleHomegateInvite }
  | { ok: false; error: HomegateInviteError };

export type RequestGoogleHomegateInviteInput = {
  googleIdToken: string;
};

export interface HomegateInvitePort {
  requestGoogleInvite(input: RequestGoogleHomegateInviteInput): Promise<HomegateInviteResult>;
}
