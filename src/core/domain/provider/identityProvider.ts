export type IdentityProviderId = "google";

export type VerifiedProviderIdentity = {
  provider: IdentityProviderId;
  issuer: string;
  subject: string;
  audience: string;
  expiresAt: Date;
};
