import "server-only";

import { createHmac } from "node:crypto";

import type { WrappingKeyRateLimiter } from "../wrappingKeyDependencies";
import { decodeWrappingKeyServerSecret } from "../secrets/serverSecret";

export type CreateInMemoryWrappingKeyRateLimiterInput = {
  serverSecretBase64: string;
  maximumRequests?: number;
  windowMilliseconds?: number;
};

const defaultMaximumRequests = 10;
const defaultWindowMilliseconds = 60_000;

/**
 * Process-local MVP limiter. It retains only HMACed verified identities, never
 * raw Google subjects. Deployments with multiple instances need shared storage.
 */
export class InMemoryWrappingKeyRateLimiter implements WrappingKeyRateLimiter {
  readonly #identityPepper: Buffer;
  readonly #maximumRequests: number;
  readonly #windowMilliseconds: number;
  readonly #requestsByIdentity = new Map<string, number[]>();

  constructor(options: {
    identityPepper: Uint8Array;
    maximumRequests: number;
    windowMilliseconds: number;
  }) {
    if (options.maximumRequests < 1 || options.windowMilliseconds < 1) {
      throw new Error("Invalid wrapping key rate limit configuration.");
    }

    this.#identityPepper = Buffer.from(options.identityPepper);
    this.#maximumRequests = options.maximumRequests;
    this.#windowMilliseconds = options.windowMilliseconds;
  }

  async checkWrappingKeyRequest(input: {
    provider: "google";
    issuer: string;
    subject: string;
    at: Date;
  }): Promise<{ allowed: true } | { allowed: false }> {
    const now = input.at.getTime();
    if (!Number.isFinite(now)) {
      throw new Error("Invalid wrapping key rate limit request.");
    }

    const cutoff = now - this.#windowMilliseconds;
    this.removeExpiredRequests(cutoff);

    const identity = this.identityHash(input.issuer, input.subject);
    const requests = this.#requestsByIdentity.get(identity) ?? [];
    if (requests.length >= this.#maximumRequests) {
      return { allowed: false };
    }

    requests.push(now);
    this.#requestsByIdentity.set(identity, requests);
    return { allowed: true };
  }

  private removeExpiredRequests(cutoff: number): void {
    for (const [identity, requests] of this.#requestsByIdentity) {
      const recentRequests = requests.filter((timestamp) => timestamp > cutoff);
      if (recentRequests.length === 0) {
        this.#requestsByIdentity.delete(identity);
      } else if (recentRequests.length !== requests.length) {
        this.#requestsByIdentity.set(identity, recentRequests);
      }
    }
  }

  private identityHash(issuer: string, subject: string): string {
    return createHmac("sha256", this.#identityPepper)
      .update(`${issuer}\n${subject}`, "utf8")
      .digest("base64url");
  }
}

export function createInMemoryWrappingKeyRateLimiter(
  input: CreateInMemoryWrappingKeyRateLimiterInput,
): InMemoryWrappingKeyRateLimiter {
  return new InMemoryWrappingKeyRateLimiter({
    identityPepper: decodeWrappingKeyServerSecret(input.serverSecretBase64),
    maximumRequests: input.maximumRequests ?? defaultMaximumRequests,
    windowMilliseconds: input.windowMilliseconds ?? defaultWindowMilliseconds,
  });
}
