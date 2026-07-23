import "client-only";

import { Result } from "better-result";

import { pubkySecretKeyFormat, type PubkyIdentityKey } from "../../../features/identity/pubkyIdentity";
import { logger } from "../../../libs/logger/logger";
import type { PassportFileCrypto, PubkyIdentityKeys, PubkySignup } from "../applicationContracts";
import type { LocalIdentitySaver } from "../localIdentityService";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityFlowResult,
  RestoreExistingGoogleDriveIdentity,
} from "./applicationContracts";

export class RestoreExistingGoogleDriveIdentityUseCase implements RestoreExistingGoogleDriveIdentity {
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #signup: PubkySignup;
  readonly #localIdentities: LocalIdentitySaver;
  readonly #passportUrl: string;

  constructor(input: {
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    signup: PubkySignup;
    localIdentities: LocalIdentitySaver;
    passportUrl: string;
  }) {
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#signup = input.signup;
    this.#localIdentities = input.localIdentities;
    this.#passportUrl = input.passportUrl;
  }

  async execute(
    input: Parameters<RestoreExistingGoogleDriveIdentity["execute"]>[0],
  ): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    logger.info("identity.google.decrypt.started");
    const secretKey = await this.#crypto.decryptSecretKeyBytes({
      envelope: input.envelope,
      wrappingKey: input.wrappingKey,
      passportUrl: this.#passportUrl,
    });
    if (Result.isError(secretKey)) {
      logger.warn("identity.google.decrypt.failed", { code: secretKey.error.code });
      return failure("decrypt_failed");
    }

    let restoredIdentity: PubkyIdentityKey | null = null;
    let retainRestoredIdentity = false;
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
      retainRestoredIdentity = true;
      return Result.ok({ ...restored.value, source: "restored" as const });
    } finally {
      secretKey.value.fill(0);
      if (restoredIdentity && !retainRestoredIdentity) {
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
): GoogleBackedIdentityFlowResult<T> {
  return Result.err(createError(code, recoverablePublicIdentity));
}

function createError(
  code: "decrypt_failed" | "restore_failed" | "signin_failed" | "identity_mismatch" | "local_save_failed",
  recoverablePublicIdentity?: PubkyIdentityKey["publicIdentity"],
) {
  return { code, ...(recoverablePublicIdentity ? { recoverablePublicIdentity } : {}) };
}
