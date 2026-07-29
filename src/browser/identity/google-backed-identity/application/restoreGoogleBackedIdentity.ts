import "client-only";

import { Result } from "better-result";

import { PUBKY_SECRET_KEY_FORMAT, type PubkyIdentityKey, type PubkyIdentityKeys } from "../../../pubky/application/pubkyIdentityKeys";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileCrypto } from "../../../passport-file/application/passportFileCrypto";
import type { PubkySessionAccess } from "../../../pubky/application/pubkySessionAccess";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityResult,
  RestoreGoogleBackedIdentityInput,
} from "./googleBackedIdentity";
import { SaveLocalIdentity } from "../../local-identity/application/saveLocalIdentity";

export class RestoreGoogleBackedIdentity {
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #sessionAccess: PubkySessionAccess;
  readonly #localIdentities: SaveLocalIdentity;
  readonly #passportOrigin: string;

  constructor(input: {
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    sessionAccess: PubkySessionAccess;
    localIdentities: SaveLocalIdentity;
    passportOrigin: string;
  }) {
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#sessionAccess = input.sessionAccess;
    this.#localIdentities = input.localIdentities;
    this.#passportOrigin = input.passportOrigin;
  }

  async execute(
    input: RestoreGoogleBackedIdentityInput,
  ): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    LOGGER.info("identity.google.decrypt.started");
    const secretKey = await this.#crypto.decryptSecretKeyBytes({
      envelope: input.envelope,
      wrappingKey: input.wrappingKey,
      passportOrigin: this.#passportOrigin,
    });
    if (Result.isError(secretKey)) {
      LOGGER.warn("identity.google.decrypt.failed", { code: secretKey.error.code });
      return failure("decrypt_failed");
    }

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#identityKeys.restoreIdentityKey({
        secretKey: { bytes: secretKey.value, format: PUBKY_SECRET_KEY_FORMAT },
      });
      if (Result.isError(restored)) {
        LOGGER.warn("identity.google.restore.failed", { code: restored.error.code });
        return failure("restore_failed");
      }
      restoredIdentity = restored.value;
      LOGGER.info("identity.google.restore.completed");

      const signedIn = await this.#sessionAccess.signin({ keyHandle: restored.value.keyHandle, waitForDiscovery: true });
      if (Result.isError(signedIn)) {
        LOGGER.warn("identity.google.signin.failed", { code: signedIn.error.code });
        return failure("signin_failed");
      }
      if (signedIn.value.publicIdentity.publicKeyZ32 !== restored.value.publicIdentity.publicKeyZ32) {
        LOGGER.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch");
      }

      LOGGER.info("identity.local_save.started", { establishmentMode: "restored" });
      const saved = await this.#localIdentities.saveIdentity({ keyHandle: restored.value.keyHandle });
      if (Result.isError(saved)) {
        LOGGER.warn("identity.local_save.failed", { code: saved.error.code });
        return failure("local_save_failed");
      }

      LOGGER.info("identity.local_save.completed", { establishmentMode: "restored" });
      return Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: restored.value.publicIdentity,
      });
    } finally {
      secretKey.value.fill(0);
      if (restoredIdentity) {
        try {
          this.#identityKeys.disposeIdentityKey({ keyHandle: restoredIdentity.keyHandle });
        } catch {
          LOGGER.warn("identity.google.cleanup.failed", { operation: "restored_key_dispose" });
        }
      }
    }
  }
}

function failure<T>(
  code: "decrypt_failed" | "restore_failed" | "signin_failed" | "identity_mismatch" | "local_save_failed",
): GoogleBackedIdentityResult<T> {
  return Result.err({ code });
}
