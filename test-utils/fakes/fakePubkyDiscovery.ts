import type { PubkyIdentityKeyHandle } from "@/core/identity/pubkyIdentity";
import { Result } from "better-result";

import type {
  PubkyDiscovery,
  PubkyDiscoveryErrorCode,
  PubkyDiscoveryResult,
} from "@/core/identity/dependencies/pubky";

export type FakePubkyDiscoveryCall = {
  keyHandle: PubkyIdentityKeyHandle;
  mode: "force" | "if_stale";
  homeserverPubky?: string | null;
};

export class FakePubkyDiscovery implements PubkyDiscovery {
  calls: FakePubkyDiscoveryCall[] = [];

  ifStaleFailure?: PubkyDiscoveryErrorCode;
  forceFailure?: PubkyDiscoveryErrorCode;

  async publishHomeserverIfStale(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult> {
    this.calls.push({
      keyHandle: input.keyHandle,
      mode: "if_stale",
      ...(input.homeserverPubky !== undefined ? { homeserverPubky: input.homeserverPubky } : {}),
    });

    if (this.ifStaleFailure) {
      return failure(this.ifStaleFailure);
    }

    return Result.ok();
  }

  async publishHomeserverForce(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult> {
    this.calls.push({
      keyHandle: input.keyHandle,
      mode: "force",
      ...(input.homeserverPubky !== undefined ? { homeserverPubky: input.homeserverPubky } : {}),
    });

    if (this.forceFailure) {
      return failure(this.forceFailure);
    }

    return Result.ok();
  }
}

function failure(code: PubkyDiscoveryErrorCode): PubkyDiscoveryResult {
  return Result.err({ code });
}
