import "client-only";

import type { Result } from "better-result";

import type { PubkySecretKeyMaterial } from "../../../pubky/ports";
import type { LocalIdentitySummary } from "./localIdentity";

export type LocalIdentityRepositoryErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "no_active_identity"
  | "storage_unavailable";

export type LocalIdentityRepositoryResult<T> = Result<T, { code: LocalIdentityRepositoryErrorCode }>;

export type LocalIdentityCatalog = {
  list(): LocalIdentityRepositoryResult<{ activeIdentityId: string | null; identities: LocalIdentitySummary[] }>;
  select(id: string): LocalIdentityRepositoryResult<void>;
  clear(): LocalIdentityRepositoryResult<void>;
};

export type LocalIdentityKeyStore = {
  save(input: { identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }): LocalIdentityRepositoryResult<LocalIdentitySummary>;
  readActive(): LocalIdentityRepositoryResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }>;
};

export type LocalIdentityRepository = LocalIdentityCatalog & LocalIdentityKeyStore;
