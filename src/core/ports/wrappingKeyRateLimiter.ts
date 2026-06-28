export type WrappingKeyRateLimitResult = { allowed: true } | { allowed: false };

export interface WrappingKeyRateLimiter {
  checkWrappingKeyRequest(input: {
    issuer: string;
    subject: string;
    at: Date;
  }): Promise<WrappingKeyRateLimitResult>;
}
