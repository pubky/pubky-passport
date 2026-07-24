import "client-only";

import { Result } from "better-result";

import type { PubkyIdentityKeyHandle, PubkyIdentityKeys } from "../../../pubky/ports";
import type { LocalIdentitySummary } from "./localIdentity";
import type { LocalIdentityKeyStore, LocalIdentityRepositoryErrorCode } from "./localIdentityRepository";

export type LocalIdentityOperationErrorCode = LocalIdentityRepositoryErrorCode | "identity_mismatch" | "restore_failed";
export type LocalIdentityOperationResult<T> = Result<T, { code: LocalIdentityOperationErrorCode }>;

export type LocalIdentitySaver = {
  saveIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<LocalIdentityOperationResult<LocalIdentitySummary>>;
};

export class SaveLocalIdentity implements LocalIdentitySaver {
  readonly #keyStore: LocalIdentityKeyStore;
  readonly #identityKeys: PubkyIdentityKeys;

  constructor(input: { keyStore: LocalIdentityKeyStore; identityKeys: PubkyIdentityKeys }) {
    this.#keyStore = input.keyStore;
    this.#identityKeys = input.identityKeys;
  }

  async saveIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<LocalIdentityOperationResult<LocalIdentitySummary>> {
    const publicIdentity = await this.#identityKeys.getPublicIdentity(input);
    if (Result.isError(publicIdentity)) {
      return failure("invalid_identity");
    }

    const secretKey = await this.#identityKeys.exportSecretKey(input);
    if (Result.isError(secretKey)) {
      return failure("invalid_secret_key");
    }

    try {
      return this.#keyStore.save({
        identity: { id: publicIdentity.value.publicKeyZ32, publicIdentity: publicIdentity.value },
        secretKey: secretKey.value,
      });
    } finally {
      secretKey.value.bytes.fill(0);
    }
  }

}

function failure<T>(code: LocalIdentityOperationErrorCode): LocalIdentityOperationResult<T> {
  return Result.err({ code });
}
