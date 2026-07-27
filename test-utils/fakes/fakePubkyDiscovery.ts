import type { PubkyIdentityKeyHandle } from "@/browser/pubky/application/pubkyIdentityKeys";
import { Result } from "better-result";

import type {
  PubkyDiscovery,
  PubkyDiscoveryErrorCode,
  PubkyDiscoveryResult,
} from "@/browser/pubky/application/pubkyDiscovery";

export type FakePubkyDiscoveryCall = {
  keyHandle: PubkyIdentityKeyHandle;
  homeserverPubky?: string | null;
};

export class FakePubkyDiscovery implements PubkyDiscovery {
  calls: FakePubkyDiscoveryCall[] = [];

  ifStaleFailure?: PubkyDiscoveryErrorCode;

  async publishHomeserverIfStale(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult> {
    this.calls.push({
      keyHandle: input.keyHandle,
      ...(input.homeserverPubky !== undefined ? { homeserverPubky: input.homeserverPubky } : {}),
    });

    if (this.ifStaleFailure) {
      return failure(this.ifStaleFailure);
    }

    return Result.ok();
  }
}

function failure(code: PubkyDiscoveryErrorCode): PubkyDiscoveryResult {
  return Result.err({ code });
}
