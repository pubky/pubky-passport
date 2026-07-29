import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
export type PubkyIdentitySession = {
  publicIdentity: PubkyPublicIdentity;
};

export type PubkySessionAccessErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "signin_failed" | "signup_failed";
export type PubkySessionAccessResult<T> = Result<T, { code: PubkySessionAccessErrorCode }>;
