import "server-only";

import { createHmac } from "node:crypto";

import type { GoogleWrappingKeyRateLimiter } from "../application/googleWrappingKey";
import { decodeServerSecret } from "./serverSecret";

export type CreateInMemoryGoogleWrappingKeyRateLimiterInput = {
  serverSecretBase64: string;
  maximumRequests?: number;
  windowMilliseconds?: number;
};

const defaultMaximumRequests = 10;
const defaultWindowMilliseconds = 60_000;

/** Process-local MVP limiter; multi-instance deployments need shared storage. */
export function createInMemoryGoogleWrappingKeyRateLimiter(
  input: CreateInMemoryGoogleWrappingKeyRateLimiterInput,
): GoogleWrappingKeyRateLimiter {
  const identityPepper = decodeServerSecret(input.serverSecretBase64);
  const maximumRequests = input.maximumRequests ?? defaultMaximumRequests;
  const windowMilliseconds = input.windowMilliseconds ?? defaultWindowMilliseconds;
  const requestsByIdentity = new Map<string, number[]>();
  let nextCleanupAt = Number.NEGATIVE_INFINITY;

  if (maximumRequests < 1 || windowMilliseconds < 1) {
    throw new Error("Invalid wrapping key rate limit configuration.");
  }

  return {
    async checkRequest({ identity, at }) {
      const now = at.getTime();
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
        return { allowed: false };
      }

      requests.push(now);
      requestsByIdentity.set(identityHash, requests);
      return { allowed: true };
    },
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
