import "client-only";

import { Result } from "better-result";

import type {
  PubkyIdentityKeyHandle,
  PubkySecretKeyMaterial,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import type { LocalIdentityErrorCode, LocalIdentityResult, LocalIdentitySummary } from "./localStorageIdentityRepository";

type SaveIdentityRecord = (
  identity: LocalIdentitySummary,
  secretKey: PubkySecretKeyMaterial,
) => LocalIdentityResult<LocalIdentitySummary>;

export class SaveLocalIdentity {
  readonly #saveIdentityRecord: SaveIdentityRecord;
  readonly #pubky: PubkySdkAdapter;

  constructor(input: {
    saveIdentityRecord: SaveIdentityRecord;
    pubky: PubkySdkAdapter;
  }) {
    this.#saveIdentityRecord = input.saveIdentityRecord;
    this.#pubky = input.pubky;
  }

  async saveIdentity(keyHandle: PubkyIdentityKeyHandle): Promise<LocalIdentityResult<LocalIdentitySummary>> {
    const publicIdentity = await this.#pubky.getPublicIdentity(keyHandle);
    if (Result.isError(publicIdentity)) {
      return failure("invalid_identity");
    }

    const secretKey = await this.#pubky.exportSecretKey(keyHandle);
    if (Result.isError(secretKey)) {
      return failure("invalid_secret_key");
    }

    try {
      return this.#saveIdentityRecord(
        { id: publicIdentity.value.publicKeyZ32, publicIdentity: publicIdentity.value },
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
