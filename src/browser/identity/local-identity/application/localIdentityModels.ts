import "client-only";

import type { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../../core/identity/pubkyIdentity";

export type LocalIdentitySummary = {
  id: string;
  publicIdentity: PubkyPublicIdentity;
};

export type LocalIdentityErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "no_active_identity"
  | "storage_unavailable";

export type LocalIdentityResult<T> = Result<T, { code: LocalIdentityErrorCode }>;
