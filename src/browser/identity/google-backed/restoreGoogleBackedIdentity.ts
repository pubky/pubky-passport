import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LOGGER } from "../../../libs/logger/logger";
import type { PassportFileEnvelopeV1 } from "../../../core/passport-file/passportFile";
import type { DecryptPassportSecret } from "../../passport-file/passportFileWebCrypto";
import { SaveLocalIdentity } from "../local/saveLocalIdentity";

export type RestoredGoogleBackedIdentity = {
  establishmentMode: "restored";
  publicIdentity: PubkyPublicIdentity;
};

export type RestoreGoogleBackedIdentityError = {
  code: "decrypt_failed" | "restore_failed" | "signin_failed" | "identity_mismatch" | "local_save_failed";
  partialSetupPublicIdentity?: never;
};

export type RestoreGoogleBackedIdentityResult<T = RestoredGoogleBackedIdentity> = ResultType<
  T,
  RestoreGoogleBackedIdentityError
>;

export class RestoreGoogleBackedIdentity {
  readonly #decryptSecretKeyBytes: DecryptPassportSecret;
  readonly #pubky: PubkySdkAdapter;
  readonly #saveLocalIdentity: SaveLocalIdentity;
  readonly #passportOrigin: string;

  constructor(input: {
    decryptSecretKeyBytes: DecryptPassportSecret;
    pubky: PubkySdkAdapter;
    saveLocalIdentity: SaveLocalIdentity;
    passportOrigin: string;
  }) {
    this.#decryptSecretKeyBytes = input.decryptSecretKeyBytes;
    this.#pubky = input.pubky;
    this.#saveLocalIdentity = input.saveLocalIdentity;
    this.#passportOrigin = input.passportOrigin;
  }

  async execute(
    envelope: PassportFileEnvelopeV1,
    wrappingKey: string,
  ): Promise<RestoreGoogleBackedIdentityResult> {
    LOGGER.info("identity.google.decrypt.started");
    const secretKey = await this.#decryptSecretKeyBytes({
      envelope,
      wrappingKey,
      passportOrigin: this.#passportOrigin,
    });
    if (Result.isError(secretKey)) return failure("decrypt_failed");

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#pubky.restoreIdentityKey({ bytes: secretKey.value, format: PUBKY_SECRET_KEY_FORMAT });
      if (Result.isError(restored)) return failure("restore_failed");
      restoredIdentity = restored.value;
      LOGGER.info("identity.google.restore.completed");

      const signedIn = await this.#pubky.signin(restored.value.keyHandle, true);
      if (Result.isError(signedIn)) return failure("signin_failed");
      if (signedIn.value.publicIdentity.publicKeyZ32 !== restored.value.publicIdentity.publicKeyZ32) {
        LOGGER.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch");
      }

      LOGGER.info("identity.local_save.started", { establishmentMode: "restored" });
      const saved = await this.#saveLocalIdentity.saveIdentity(restored.value.keyHandle);
      if (Result.isError(saved)) return failure("local_save_failed");

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
  code: RestoreGoogleBackedIdentityError["code"],
): RestoreGoogleBackedIdentityResult<T> {
  return Result.err({ code });
}
