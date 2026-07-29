import "server-only";

import type { Result } from "better-result";

export const CANONICAL_GOOGLE_ISSUER = "https://accounts.google.com";

export type VerifiedGoogleIdentity = {
  issuer: typeof CANONICAL_GOOGLE_ISSUER;
  subject: string;
};

export type GoogleIdTokenVerificationResult = Result<
  VerifiedGoogleIdentity,
  { code: "invalid_google_id_token" }
>;
