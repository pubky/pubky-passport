import type { PubkyIdentityKeyHandle } from "@/core/domain/identity/pubkyIdentity";
import type {
  PublishPubkyHomeserverInput,
  PubkyDiscovery,
  PubkyDiscoveryErrorCode,
  PubkyDiscoveryResult,
} from "@/core/ports/pubkyDiscovery";

export type FakePubkyDiscoveryCall = {
  keyHandle: PubkyIdentityKeyHandle;
  mode: "force" | "if_stale";
  homeserverPubky?: string | null;
};

export class FakePubkyDiscovery implements PubkyDiscovery {
  calls: FakePubkyDiscoveryCall[] = [];

  ifStaleFailure?: PubkyDiscoveryErrorCode;
  forceFailure?: PubkyDiscoveryErrorCode;

  async publishHomeserverIfStale(input: PublishPubkyHomeserverInput): Promise<PubkyDiscoveryResult> {
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

  async publishHomeserverForce(input: PublishPubkyHomeserverInput): Promise<PubkyDiscoveryResult> {
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
import { Result } from "better-result";
