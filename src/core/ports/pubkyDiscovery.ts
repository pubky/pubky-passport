import type { PubkyIdentityKeyHandle } from "../domain/identity/pubkyIdentity";

export type PubkyDiscoveryErrorCode =
  | "invalid_homeserver_pubky"
  | "key_unavailable"
  | "publish_failed";

export type PubkyDiscoveryError = {
  code: PubkyDiscoveryErrorCode;
};

export type PubkyDiscoveryResult =
  | { ok: true }
  | { ok: false; error: PubkyDiscoveryError };

export type PublishPubkyHomeserverInput = {
  keyHandle: PubkyIdentityKeyHandle;
  homeserverPubky?: string | null;
};

export interface PubkyDiscovery {
  publishHomeserverIfStale(input: PublishPubkyHomeserverInput): Promise<PubkyDiscoveryResult>;
  publishHomeserverForce(input: PublishPubkyHomeserverInput): Promise<PubkyDiscoveryResult>;
}
