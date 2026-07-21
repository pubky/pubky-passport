import type { IdentityProviderId, VerifiedProviderIdentity } from "../domain/provider/identityProvider";

export type ProviderIdTokenVerificationFailureReason =
  | "invalid"
  | "expired"
  | "unsupported_issuer"
  | "unsupported_audience"
  | "missing_subject";

export type ProviderIdTokenVerificationResult =
  | { ok: true; identity: VerifiedProviderIdentity }
  | { ok: false; reason: ProviderIdTokenVerificationFailureReason };

export interface ProviderIdTokenVerifier {
  readonly provider: IdentityProviderId;
  verifyIdToken(idToken: string): Promise<ProviderIdTokenVerificationResult>;
}
