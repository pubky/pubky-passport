import "client-only";

import { Result } from "better-result";

import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
} from "../../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../../pubky/pubkySdkAdapter";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileEnvelopeV1 } from "../../../../core/passport-file/passportFile";
import type { DecryptPassportSecret } from "../../../passport-file/passportFileCryptoResults";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";
import { SaveLocalIdentity } from "../../local-identity/application/saveLocalIdentity";

export class RestoreGoogleBackedIdentity {
  readonly #decryptSecretKeyBytes: DecryptPassportSecret;
  readonly #pubky: PubkySdkAdapter;
  readonly #localIdentities: SaveLocalIdentity;
  readonly #passportOrigin: string;

  constructor(input: {
    decryptSecretKeyBytes: DecryptPassportSecret;
    pubky: PubkySdkAdapter;
    localIdentities: SaveLocalIdentity;
    passportOrigin: string;
  }) {
    this.#decryptSecretKeyBytes = input.decryptSecretKeyBytes;
    this.#pubky = input.pubky;
    this.#localIdentities = input.localIdentities;
    this.#passportOrigin = input.passportOrigin;
  }

  async execute(
    envelope: PassportFileEnvelopeV1,
    wrappingKey: string,
  ): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    LOGGER.info("identity.google.decrypt.started");
    const secretKey = await this.#decryptSecretKeyBytes({
      envelope,
      wrappingKey,
      passportOrigin: this.#passportOrigin,
    });
    if (Result.isError(secretKey)) {
      LOGGER.warn("identity.google.decrypt.failed", { code: secretKey.error.code });
      return failure("decrypt_failed");
    }

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#pubky.restoreIdentityKey({ bytes: secretKey.value, format: PUBKY_SECRET_KEY_FORMAT });
      if (Result.isError(restored)) {
        LOGGER.warn("identity.google.restore.failed", { code: restored.error.code });
        return failure("restore_failed");
      }
      restoredIdentity = restored.value;
      LOGGER.info("identity.google.restore.completed");

      const signedIn = await this.#pubky.signin(restored.value.keyHandle, true);
      if (Result.isError(signedIn)) {
        LOGGER.warn("identity.google.signin.failed", { code: signedIn.error.code });
        return failure("signin_failed");
      }
      if (signedIn.value.publicIdentity.publicKeyZ32 !== restored.value.publicIdentity.publicKeyZ32) {
        LOGGER.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch");
      }

      LOGGER.info("identity.local_save.started", { establishmentMode: "restored" });
      const saved = await this.#localIdentities.saveIdentity(restored.value.keyHandle);
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
          this.#pubky.disposeIdentityKey(restoredIdentity.keyHandle);
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
