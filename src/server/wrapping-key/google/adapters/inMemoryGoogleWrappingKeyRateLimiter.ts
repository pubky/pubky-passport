import "server-only";

import { createHmac } from "node:crypto";

import type { CheckGoogleWrappingKeyRateLimit } from "../application/requestGoogleWrappingKey";

export type CreateInMemoryGoogleWrappingKeyRateLimiterInput = {
  identityPepper: Uint8Array;
  maximumRequests?: number;
  windowMilliseconds?: number;
  now?: () => Date;
};

const DEFAULT_MAXIMUM_REQUESTS = 10;
const DEFAULT_WINDOW_MILLISECONDS = 60_000;

/** Process-local MVP limiter; multi-instance deployments need shared storage. */
export function createInMemoryGoogleWrappingKeyRateLimiter(
  input: CreateInMemoryGoogleWrappingKeyRateLimiterInput,
): CheckGoogleWrappingKeyRateLimit {
  const identityPepper = Buffer.from(input.identityPepper);
  const maximumRequests = input.maximumRequests ?? DEFAULT_MAXIMUM_REQUESTS;
  const windowMilliseconds = input.windowMilliseconds ?? DEFAULT_WINDOW_MILLISECONDS;
  const currentTime = input.now ?? (() => new Date());
  const requestsByIdentity = new Map<string, number[]>();
  let nextCleanupAt = Number.NEGATIVE_INFINITY;

  if (maximumRequests < 1 || windowMilliseconds < 1) {
    throw new Error("Invalid wrapping key rate limit configuration.");
  }

  return async function checkGoogleWrappingKeyRateLimit(identity) {
    const now = currentTime().getTime();
    if (!Number.isFinite(now)) {
      throw new Error("Invalid wrapping key rate limit request.");
    }

    const cutoff = now - windowMilliseconds;
    if (now >= nextCleanupAt) {
      removeExpiredRequests(requestsByIdentity, cutoff);
      nextCleanupAt = now + windowMilliseconds;
    }

    const identityHash = createHmac("sha256", identityPepper)
      .update(`${identity.issuer}\n${identity.subject}`, "utf8")
      .digest("base64url");
    const requests = recentRequests(requestsByIdentity.get(identityHash) ?? [], cutoff);
    if (requests.length >= maximumRequests) {
      return false;
    }

    requests.push(now);
    requestsByIdentity.set(identityHash, requests);
    return true;
  };
}

function removeExpiredRequests(requestsByIdentity: Map<string, number[]>, cutoff: number): void {
  for (const [identity, requests] of requestsByIdentity) {
    const activeRequests = recentRequests(requests, cutoff);
    if (activeRequests.length === 0) {
      requestsByIdentity.delete(identity);
    } else if (activeRequests.length !== requests.length) {
      requestsByIdentity.set(identity, activeRequests);
    }
  }
}

function recentRequests(requests: number[], cutoff: number): number[] {
  return requests.filter((timestamp) => timestamp > cutoff);
}
