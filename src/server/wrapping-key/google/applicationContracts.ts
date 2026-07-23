import "server-only";

import type { Result } from "better-result";

export const canonicalGoogleIssuer = "https://accounts.google.com";

export type VerifiedGoogleIdentity = {
  issuer: typeof canonicalGoogleIssuer;
  subject: string;
};

export type GoogleIdTokenVerificationErrorCode =
  | "invalid"
  | "expired"
  | "unsupported_issuer"
  | "unsupported_audience"
  | "missing_subject";

export type GoogleIdTokenVerificationResult = Result<
  VerifiedGoogleIdentity,
  { code: GoogleIdTokenVerificationErrorCode }
>;

export type GoogleIdTokenVerifier = {
  verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult>;
};

export type GoogleWrappingKeyMaterial = {
  deriveWrappingKey(identity: VerifiedGoogleIdentity): Promise<{ wrappingKey: string }>;
};

export type GoogleWrappingKeyRateLimiter = {
  checkRequest(input: {
    identity: VerifiedGoogleIdentity;
    at: Date;
  }): Promise<{ allowed: true } | { allowed: false }>;
};
