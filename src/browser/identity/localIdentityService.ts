import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { LocalIdentitySummary } from "../../features/identity/localIdentity";
import type { PubkyIdentityKey, PubkyIdentityKeyHandle, PubkyPublicIdentity, PubkySecretKeyMaterial } from "../../features/identity/pubkyIdentity";
import type { PubkyIdentityKeys } from "../pubky/pubkyPorts";

export type LocalIdentityRepositoryErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "no_active_identity"
  | "storage_unavailable";

export type LocalIdentityRepositoryResult<T> = ResultType<T, { code: LocalIdentityRepositoryErrorCode }>;

export type LocalIdentityRepository = {
  list(): LocalIdentityRepositoryResult<{ activeIdentityId: string | null; identities: LocalIdentitySummary[] }>;
  save(input: { identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }): LocalIdentityRepositoryResult<LocalIdentitySummary>;
  select(id: string): LocalIdentityRepositoryResult<void>;
  clear(): LocalIdentityRepositoryResult<void>;
  readActive(): LocalIdentityRepositoryResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }>;
};

export type LocalIdentityServiceErrorCode =
  | LocalIdentityRepositoryErrorCode
  | "identity_mismatch"
  | "restore_failed";

export type LocalIdentityServiceResult<T> = ResultType<T, { code: LocalIdentityServiceErrorCode }>;

export type LocalIdentitySaver = {
  saveIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<LocalIdentityServiceResult<LocalIdentitySummary>>;
};

export type ActiveLocalIdentityRestorer = {
  restoreActiveIdentity(): Promise<LocalIdentityServiceResult<PubkyIdentityKey>>;
};

export class LocalIdentityService implements LocalIdentitySaver, ActiveLocalIdentityRestorer {
  readonly #repository: LocalIdentityRepository;
  readonly #identityKeys: PubkyIdentityKeys;

  constructor(input: { repository: LocalIdentityRepository; identityKeys: PubkyIdentityKeys }) {
    this.#repository = input.repository;
    this.#identityKeys = input.identityKeys;
  }

  async saveIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<LocalIdentityServiceResult<LocalIdentitySummary>> {
    const publicIdentity = await this.#identityKeys.getPublicIdentity(input);
    if (Result.isError(publicIdentity)) {
      return failure("invalid_identity");
    }

    const secretKey = await this.#identityKeys.exportSecretKey(input);
    if (Result.isError(secretKey)) {
      return failure("invalid_secret_key");
    }

    try {
      return this.#repository.save({
        identity: { id: publicIdentity.value.publicKeyZ32, publicIdentity: publicIdentity.value },
        secretKey: secretKey.value,
      });
    } finally {
      secretKey.value.bytes.fill(0);
    }
  }

  async restoreActiveIdentity(): Promise<LocalIdentityServiceResult<PubkyIdentityKey>> {
    const stored = this.#repository.readActive();
    if (Result.isError(stored)) {
      return Result.err(stored.error);
    }

    try {
      const restored = await this.#identityKeys.restoreIdentityKey({ secretKey: stored.value.secretKey });
      if (Result.isError(restored)) {
        return failure("restore_failed");
      }

      if (!isSamePublicIdentity(restored.value.publicIdentity, stored.value.identity.publicIdentity)) {
        this.#identityKeys.disposeIdentityKey({ keyHandle: restored.value.keyHandle });
        return failure("identity_mismatch");
      }

      return Result.ok(restored.value);
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }
}

function isSamePublicIdentity(left: PubkyPublicIdentity, right: PubkyPublicIdentity): boolean {
  return left.publicKeyZ32 === right.publicKeyZ32 && left.publicKeyDisplay === right.publicKeyDisplay;
}

function failure<T>(code: LocalIdentityServiceErrorCode): LocalIdentityServiceResult<T> {
  return Result.err({ code });
}
