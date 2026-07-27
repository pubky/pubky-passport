import "client-only";

import { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../../core/identity/pubkyIdentity";
import type { PubkyIdentityKey, PubkyIdentityKeys } from "../../../pubky/application/pubkyIdentityKeys";
import type { LocalIdentityKeyStore } from "./localIdentityRepository";
import type { LocalIdentityOperationResult } from "./saveLocalIdentity";

export class RestoreActiveLocalIdentityKey {
  readonly #keyStore: LocalIdentityKeyStore;
  readonly #identityKeys: PubkyIdentityKeys;

  constructor(input: { keyStore: LocalIdentityKeyStore; identityKeys: PubkyIdentityKeys }) {
    this.#keyStore = input.keyStore;
    this.#identityKeys = input.identityKeys;
  }

  async restore(): Promise<LocalIdentityOperationResult<PubkyIdentityKey>> {
    const stored = this.#keyStore.readActive();
    if (Result.isError(stored)) return Result.err(stored.error);

    try {
      const restored = await this.#identityKeys.restoreIdentityKey({ secretKey: stored.value.secretKey });
      if (Result.isError(restored)) return Result.err({ code: "restore_failed" });

      if (!isSamePublicIdentity(restored.value.publicIdentity, stored.value.identity.publicIdentity)) {
        this.#identityKeys.disposeIdentityKey({ keyHandle: restored.value.keyHandle });
        return Result.err({ code: "identity_mismatch" });
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
