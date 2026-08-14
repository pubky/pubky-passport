import "client-only";

import { Result } from "better-result";
import type { GoogleAccountProfile } from "../google-backed/googleAccountProfile";

import type {
  PubkyIdentityKeyHandle,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LocalStorageIdentityRepository, type LocalIdentityErrorCode, type LocalIdentityMetadata, type LocalIdentityResult } from "./localStorageIdentityRepository";

/**
 * Retrieves a public identity and secret key from Pubky SDK, and saves them to the local identity repository.
 */
export class SaveLocalIdentity {
  constructor(
    private repository: LocalStorageIdentityRepository,
    private pubky: PubkySdkAdapter,
  ) {}

  async saveIdentity(
    keyHandle: PubkyIdentityKeyHandle,
    googleAccount?: GoogleAccountProfile
  ): Promise<LocalIdentityResult<LocalIdentityMetadata>>{
    const publicIdentity = await this.pubky.getPublicIdentity(keyHandle);
    if (Result.isError(publicIdentity)) {
      return failure("invalid_identity");
    }

    const secretKey = await this.pubky.exportSecretKey(keyHandle);
    if (Result.isError(secretKey)) {
      return failure("invalid_secret_key");
    }

    try {
      return this.repository.save(
        { id: publicIdentity.value.publicKeyZ32, publicIdentity: publicIdentity.value, ...(googleAccount ? { googleAccount } : {}) },
        secretKey.value,
      );
    } finally {
      secretKey.value.bytes.fill(0);
    }
  }
}

export type SaveLocalIdentityOperation = SaveLocalIdentity["saveIdentity"];

function failure<Success>(code: LocalIdentityErrorCode): LocalIdentityResult<Success> {
  return Result.err({ code });
}
