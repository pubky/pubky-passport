import "server-only";

import { createHmac } from "node:crypto";

import type { VerifiedGoogleIdentity } from "./googleIdTokenVerification";

const MAXIMUM_REQUESTS = 10;
const WINDOW_MILLISECONDS = 60_000;

/** Process-local limiter; multi-instance deployments need shared storage. */
export class InMemoryGoogleWrappingKeyRateLimiter {
  private identityPepper: Buffer;
  private requestsByIdentity = new Map<string, number[]>();
  private nextCleanupAt = Number.NEGATIVE_INFINITY;

  constructor(identityPepper: Uint8Array) {
    this.identityPepper = Buffer.from(identityPepper);
  }

  tryConsumeRequest(identity: VerifiedGoogleIdentity): boolean {
    const now = Date.now();
    const cutoff = now - WINDOW_MILLISECONDS;
    if (now >= this.nextCleanupAt) {
      removeExpiredRequests(this.requestsByIdentity, cutoff);
      this.nextCleanupAt = now + WINDOW_MILLISECONDS;
    }

    const identityHash = createHmac("sha256", this.identityPepper)
      .update(`${identity.issuer}\n${identity.googleSubject}`, "utf8")
      .digest("base64url");
    const requests = recentRequests(this.requestsByIdentity.get(identityHash) ?? [], cutoff);
    if (requests.length >= MAXIMUM_REQUESTS) {
      return false;
    }

    requests.push(now);
    this.requestsByIdentity.set(identityHash, requests);
    return true;
  }
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
