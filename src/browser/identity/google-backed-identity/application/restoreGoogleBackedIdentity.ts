import "client-only";

import { Result } from "better-result";

import { pubkySecretKeyFormat, type PubkyIdentityKey } from "../../../pubky/ports";
import { logger } from "../../../../libs/logger/logger";
import type { PassportFileCrypto } from "../../../passport-file/ports";
import type { PubkyIdentityKeys, PubkySignup } from "../../../pubky/ports";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityResult,
  GoogleBackedIdentityRestorer,
} from "./googleBackedIdentity";
import type { LocalIdentitySaver } from "../../application/ports/localIdentity";

export class RestoreGoogleBackedIdentity implements GoogleBackedIdentityRestorer {
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #signup: PubkySignup;
  readonly #localIdentities: LocalIdentitySaver;
  readonly #passportOrigin: string;

  constructor(input: {
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    signup: PubkySignup;
    localIdentities: LocalIdentitySaver;
    passportOrigin: string;
  }) {
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#signup = input.signup;
    this.#localIdentities = input.localIdentities;
    this.#passportOrigin = input.passportOrigin;
  }

  async execute(
    input: Parameters<GoogleBackedIdentityRestorer["execute"]>[0],
  ): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    logger.info("identity.google.decrypt.started");
    const secretKey = await this.#crypto.decryptSecretKeyBytes({
      envelope: input.envelope,
      wrappingKey: input.wrappingKey,
      passportOrigin: this.#passportOrigin,
    });
    if (Result.isError(secretKey)) {
      logger.warn("identity.google.decrypt.failed", { code: secretKey.error.code });
      return failure("decrypt_failed");
    }

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#identityKeys.restoreIdentityKey({
        secretKey: { bytes: secretKey.value, format: pubkySecretKeyFormat },
      });
      if (Result.isError(restored)) {
        logger.warn("identity.google.restore.failed", { code: restored.error.code });
        return failure("restore_failed");
      }
      restoredIdentity = restored.value;
      logger.info("identity.google.restore.completed");

      const signedIn = await this.#signup.signin({ keyHandle: restored.value.keyHandle, waitForDiscovery: true });
      if (Result.isError(signedIn)) {
        logger.warn("identity.google.signin.failed", { code: signedIn.error.code });
        return failure("signin_failed", restored.value.publicIdentity);
      }
      if (signedIn.value.publicIdentity.publicKeyZ32 !== restored.value.publicIdentity.publicKeyZ32) {
        logger.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch", restored.value.publicIdentity);
      }

      logger.info("identity.local_save.started", { source: "restored" });
      const saved = await this.#localIdentities.saveIdentity({ keyHandle: restored.value.keyHandle });
      if (Result.isError(saved)) {
        logger.warn("identity.local_save.failed", { code: saved.error.code });
        return failure("local_save_failed", restored.value.publicIdentity);
      }

      logger.info("identity.local_save.completed", { source: "restored" });
      return Result.ok({
        source: "restored" as const,
        publicIdentity: restored.value.publicIdentity,
      });
    } finally {
      secretKey.value.fill(0);
      if (restoredIdentity) {
        try {
          this.#identityKeys.disposeIdentityKey({ keyHandle: restoredIdentity.keyHandle });
        } catch {
          logger.warn("identity.google.cleanup.failed", { operation: "restored_key_dispose" });
        }
      }
    }
  }
}

function failure<T>(
  code: Parameters<typeof createError>[0],
  recoverablePublicIdentity?: Parameters<typeof createError>[1],
): GoogleBackedIdentityResult<T> {
  return Result.err(createError(code, recoverablePublicIdentity));
}

function createError(
  code: "decrypt_failed" | "restore_failed" | "signin_failed" | "identity_mismatch" | "local_save_failed",
  recoverablePublicIdentity?: PubkyIdentityKey["publicIdentity"],
) {
  return { code, ...(recoverablePublicIdentity ? { recoverablePublicIdentity } : {}) };
}
