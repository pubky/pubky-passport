import "client-only";

import { Result } from "better-result";

import type {
  PubkyIdentityKeyHandle,
  PubkySecretKeyMaterial,
} from "../../../pubky/application/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../../pubky/adapters/pubkySdkAdapter";
import type { LocalIdentityErrorCode, LocalIdentityResult, LocalIdentitySummary } from "./localIdentityModels";

export type LocalIdentityOperationErrorCode = LocalIdentityErrorCode | "identity_mismatch" | "restore_failed";
export type LocalIdentityOperationResult<T> = Result<T, { code: LocalIdentityOperationErrorCode }>;
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

  async saveIdentity(keyHandle: PubkyIdentityKeyHandle): Promise<LocalIdentityOperationResult<LocalIdentitySummary>> {
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

function failure<T>(code: LocalIdentityOperationErrorCode): LocalIdentityOperationResult<T> {
  return Result.err({ code });
}
