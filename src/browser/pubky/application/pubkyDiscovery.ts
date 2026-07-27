import "client-only";

import type { Result } from "better-result";

import type { PubkyIdentityKeyHandle } from "./pubkyIdentityKeys";

export type PubkyDiscoveryErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "publish_failed";
export type PubkyDiscoveryResult = Result<void, { code: PubkyDiscoveryErrorCode }>;

export type PubkyDiscovery = {
  publishHomeserverIfStale(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult>;
};
