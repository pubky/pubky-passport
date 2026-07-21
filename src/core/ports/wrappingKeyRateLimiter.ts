import type { IdentityProviderId } from "../domain/provider/identityProvider";

export type WrappingKeyRateLimitResult = { allowed: true } | { allowed: false };

export interface WrappingKeyRateLimiter {
  checkWrappingKeyRequest(input: {
    provider: IdentityProviderId;
    issuer: string;
    subject: string;
    at: Date;
  }): Promise<WrappingKeyRateLimitResult>;
}
