import "server-only";

import { createHmac } from "node:crypto";

import type { VerifiedGoogleIdentity } from "../application/googleIdTokenVerification";

const DEFAULT_MAXIMUM_REQUESTS = 10;
const DEFAULT_WINDOW_MILLISECONDS = 60_000;

/** Process-local limiter; multi-instance deployments need shared storage. */
export class InMemoryGoogleWrappingKeyRateLimiter {
  readonly #identityPepper: Buffer;
  readonly #maximumRequests: number;
  readonly #windowMilliseconds: number;
  readonly #currentTime: () => Date;
  readonly #requestsByIdentity = new Map<string, number[]>();
  #nextCleanupAt = Number.NEGATIVE_INFINITY;

  constructor(options: {
    identityPepper: Uint8Array;
    maximumRequests?: number;
    windowMilliseconds?: number;
    now?: () => Date;
  }) {
    this.#identityPepper = Buffer.from(options.identityPepper);
    this.#maximumRequests = options.maximumRequests ?? DEFAULT_MAXIMUM_REQUESTS;
    this.#windowMilliseconds = options.windowMilliseconds ?? DEFAULT_WINDOW_MILLISECONDS;
    this.#currentTime = options.now ?? (() => new Date());

    if (
      !Number.isSafeInteger(this.#maximumRequests)
      || this.#maximumRequests < 1
      || !Number.isSafeInteger(this.#windowMilliseconds)
      || this.#windowMilliseconds < 1
    ) {
      throw new Error("Invalid wrapping key rate limit configuration.");
    }
  }

  tryConsumeRequest(identity: VerifiedGoogleIdentity): boolean {
    const now = this.#currentTime().getTime();
    if (!Number.isFinite(now)) {
      throw new Error("Invalid wrapping key rate limit request.");
    }

    const cutoff = now - this.#windowMilliseconds;
    if (now >= this.#nextCleanupAt) {
      removeExpiredRequests(this.#requestsByIdentity, cutoff);
      this.#nextCleanupAt = now + this.#windowMilliseconds;
    }

    const identityHash = createHmac("sha256", this.#identityPepper)
      .update(`${identity.issuer}\n${identity.subject}`, "utf8")
      .digest("base64url");
    const requests = recentRequests(this.#requestsByIdentity.get(identityHash) ?? [], cutoff);
    if (requests.length >= this.#maximumRequests) {
      return false;
    }

    requests.push(now);
    this.#requestsByIdentity.set(identityHash, requests);
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
