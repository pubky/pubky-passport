import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import type { PubkyIdentityKeyHandle } from "./pubkyIdentityKeys";

export type PubkyIdentitySession = {
  publicIdentity: PubkyPublicIdentity;
};

export type PubkySessionAccessErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "signin_failed" | "signup_failed";
export type PubkySessionAccessResult<T> = Result<T, { code: PubkySessionAccessErrorCode }>;

export type PubkySessionAccess = {
  signup(input: {
    keyHandle: PubkyIdentityKeyHandle;
    homeserverPubky: string;
    signupCode?: string | null;
  }): Promise<PubkySessionAccessResult<PubkyIdentitySession>>;
  signin(input: { keyHandle: PubkyIdentityKeyHandle; waitForDiscovery?: boolean }): Promise<PubkySessionAccessResult<PubkyIdentitySession>>;
};
