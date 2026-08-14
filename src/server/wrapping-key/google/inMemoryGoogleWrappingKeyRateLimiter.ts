import "server-only";

import { createHmac } from "node:crypto";

import type { VerifiedGoogleIdentity } from "./googleIdTokenVerification";

const DEFAULT_MAXIMUM_REQUESTS = 10;
const DEFAULT_WINDOW_MILLISECONDS = 60_000;

/** Process-local limiter; multi-instance deployments need shared storage. */
export class InMemoryGoogleWrappingKeyRateLimiter {
  private identityPepper: Buffer;
  private requestsByIdentity = new Map<string, number[]>();
  private nextCleanupAt = Number.NEGATIVE_INFINITY;

  constructor(
    identityPepper: Uint8Array,
    private maximumRequests = DEFAULT_MAXIMUM_REQUESTS,
    private windowMilliseconds = DEFAULT_WINDOW_MILLISECONDS,
    private currentTime: () => Date = () => new Date(),
  ) {
    this.identityPepper = Buffer.from(identityPepper);

    if (
      !Number.isSafeInteger(this.maximumRequests)
      || this.maximumRequests < 1
      || !Number.isSafeInteger(this.windowMilliseconds)
      || this.windowMilliseconds < 1
    ) {
      throw new Error("Invalid wrapping key rate limit configuration.");
    }
  }

  tryConsumeRequest(identity: VerifiedGoogleIdentity): boolean {
    const now = this.currentTime().getTime();
    if (!Number.isFinite(now)) {
      throw new Error("Invalid wrapping key rate limit request.");
    }

    const cutoff = now - this.windowMilliseconds;
    if (now >= this.nextCleanupAt) {
      removeExpiredRequests(this.requestsByIdentity, cutoff);
      this.nextCleanupAt = now + this.windowMilliseconds;
    }

    const identityHash = createHmac("sha256", this.identityPepper)
      .update(`${identity.issuer}\n${identity.subject}`, "utf8")
      .digest("base64url");
    const requests = recentRequests(this.requestsByIdentity.get(identityHash) ?? [], cutoff);
    if (requests.length >= this.maximumRequests) {
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
