export type VerifiedGoogleIdentity = {
  issuer: string;
  subject: string;
  audience: string;
  expiresAt: Date;
};

export type GoogleIdTokenVerificationFailureReason =
  | "invalid"
  | "expired"
  | "unsupported_issuer"
  | "unsupported_audience"
  | "missing_subject";

export type GoogleIdTokenVerificationResult =
  | { ok: true; identity: VerifiedGoogleIdentity }
  | { ok: false; reason: GoogleIdTokenVerificationFailureReason };

export interface GoogleIdTokenVerifier {
  verifyIdToken(idToken: string): Promise<GoogleIdTokenVerificationResult>;
}
