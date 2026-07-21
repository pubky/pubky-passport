import type { IdentityProviderId, VerifiedProviderIdentity } from "../identityProvider";

/**
 * Dependencies required only by the server-owned wrapping-key flow.
 * Concrete Google, clock, rate-limit, and HKDF code stays in adapters.
 */
export type Clock = {
  now(): Date;
};

export type ProviderIdTokenVerificationFailureReason =
  | "invalid"
  | "expired"
  | "unsupported_issuer"
  | "unsupported_audience"
  | "missing_subject";

export type ProviderIdTokenVerificationResult =
  | { ok: true; identity: VerifiedProviderIdentity }
  | { ok: false; reason: ProviderIdTokenVerificationFailureReason };

export type ProviderIdTokenVerifier = {
  readonly provider: IdentityProviderId;
  verifyIdToken(idToken: string): Promise<ProviderIdTokenVerificationResult>;
};

export type WrappingKeyDeriver = {
  deriveWrappingKey(input: {
    provider: IdentityProviderId;
    issuer: string;
    subject: string;
  }): Promise<{ wrappingKey: string }>;
};

export type WrappingKeyRateLimiter = {
  checkWrappingKeyRequest(input: {
    provider: IdentityProviderId;
    issuer: string;
    subject: string;
    at: Date;
  }): Promise<{ allowed: true } | { allowed: false }>;
};
