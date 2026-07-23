import "client-only";

import type { Result } from "better-result";

import type { LocalIdentitySummary } from "../../../../features/identity/localIdentity";
import type { PubkySecretKeyMaterial } from "../../../../features/identity/pubkyIdentity";

export type LocalIdentityRepositoryErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "no_active_identity"
  | "storage_unavailable";

export type LocalIdentityRepositoryResult<T> = Result<T, { code: LocalIdentityRepositoryErrorCode }>;

export type LocalIdentityRepository = {
  list(): LocalIdentityRepositoryResult<{ activeIdentityId: string | null; identities: LocalIdentitySummary[] }>;
  save(input: { identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }): LocalIdentityRepositoryResult<LocalIdentitySummary>;
  select(id: string): LocalIdentityRepositoryResult<void>;
  clear(): LocalIdentityRepositoryResult<void>;
  readActive(): LocalIdentityRepositoryResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }>;
};
