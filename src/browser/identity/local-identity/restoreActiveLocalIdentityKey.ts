import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import { LOGGER } from "../../../libs/logger/logger";
import type {
  PubkyIdentityKey,
  PubkySecretKeyMaterial,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import type {
  LocalIdentityErrorCode,
  LocalIdentityResult,
  LocalIdentitySummary,
} from "./localStorageIdentityRepository";

export class RestoreActiveLocalIdentityKey {
  readonly #readActive: ReadActiveIdentity;
  readonly #pubky: PubkySdkAdapter;

  constructor(input: {
    readActive: ReadActiveIdentity;
    pubky: PubkySdkAdapter;
  }) {
    this.#readActive = input.readActive;
    this.#pubky = input.pubky;
  }

  async restore(): Promise<RestoreActiveLocalIdentityResult<PubkyIdentityKey>> {
    const stored = this.#readActive();
    if (Result.isError(stored)) return Result.err(stored.error);

    try {
      const restored = await this.#pubky.restoreIdentityKey(stored.value.secretKey);
      if (Result.isError(restored)) return Result.err({ code: "restore_failed" });

      if (!isSamePublicIdentity(restored.value.publicIdentity, stored.value.identity.publicIdentity)) {
        this.#pubky.disposeIdentityKey(restored.value.keyHandle);
        LOGGER.warn("identity.local_restore.failed", { code: "identity_mismatch" });
        return Result.err({ code: "identity_mismatch" });
      }

      return Result.ok(restored.value);
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }
}

type ReadActiveIdentity = () => LocalIdentityResult<{
    identity: LocalIdentitySummary;
    secretKey: PubkySecretKeyMaterial;
  }>;
type RestoreActiveLocalIdentityResult<T> = ResultType<
  T,
  { code: LocalIdentityErrorCode | "identity_mismatch" | "restore_failed" }
>;

function isSamePublicIdentity(left: PubkyPublicIdentity, right: PubkyPublicIdentity): boolean {
  return left.publicKeyZ32 === right.publicKeyZ32 && left.publicKeyDisplay === right.publicKeyDisplay;
}
