import "client-only";

import { Result } from "better-result";
import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";

import type {
  PubkyIdentityKeyHandle,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LocalStorageIdentityRepository, type LocalIdentityErrorCode, type LocalIdentityMetadata, type LocalIdentityResult } from "./localStorageIdentityRepository";

export class SaveLocalIdentity {
  readonly #repository: LocalStorageIdentityRepository;
  readonly #pubky: PubkySdkAdapter;

  constructor(repository: LocalStorageIdentityRepository, pubky: PubkySdkAdapter) {
    this.#repository = repository;
    this.#pubky = pubky;
  }

  async saveIdentity(keyHandle: PubkyIdentityKeyHandle, googleAccount?: GoogleAccountProfile): Promise<LocalIdentityResult<LocalIdentityMetadata>> {
    const publicIdentity = await this.#pubky.getPublicIdentity(keyHandle);
    if (Result.isError(publicIdentity)) {
      return failure("invalid_identity");
    }

    const secretKey = await this.#pubky.exportSecretKey(keyHandle);
    if (Result.isError(secretKey)) {
      return failure("invalid_secret_key");
    }

    try {
      return this.#repository.save(
        { id: publicIdentity.value.publicKeyZ32, publicIdentity: publicIdentity.value, ...(googleAccount ? { googleAccount } : {}) },
        secretKey.value,
      );
    } finally {
      secretKey.value.bytes.fill(0);
    }
  }

}

function failure<T>(code: LocalIdentityErrorCode): LocalIdentityResult<T> {
  return Result.err({ code });
}
