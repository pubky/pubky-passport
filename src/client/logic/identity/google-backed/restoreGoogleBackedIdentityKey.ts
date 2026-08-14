import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import type { DecryptPassportSecret } from "../../passport-file/passportFileWebCrypto";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";

export type RestoreGoogleBackedIdentityKeyResult = ResultType<
  PubkyIdentityKey,
  { code: "decrypt_failed" | "restore_failed" }
>;

/** Decrypts one Passport file and restores its key into the owning Pubky adapter. */
export class RestoreGoogleBackedIdentityKey {
  constructor(private readonly dependencies: {
    decryptSecretKeyBytes: DecryptPassportSecret;
    pubky: PubkySdkAdapter;
    passportOrigin: string;
  }) {}

  async execute(
    envelope: PassportFileEnvelopeV1,
    wrappingKey: string,
  ): Promise<RestoreGoogleBackedIdentityKeyResult> {
    LOGGER.info("identity.google.decrypt.started");
    const secretKey = await this.dependencies.decryptSecretKeyBytes({
      envelope,
      wrappingKey,
      passportOrigin: this.dependencies.passportOrigin,
    });
    if (Result.isError(secretKey)) return Result.err({ code: "decrypt_failed" });

    try {
      const restored = await this.dependencies.pubky.restoreIdentityKey({
        bytes: secretKey.value,
        format: PUBKY_SECRET_KEY_FORMAT,
      });
      if (Result.isError(restored)) return Result.err({ code: "restore_failed" });
      LOGGER.info("identity.google.restore.completed");
      return Result.ok(restored.value);
    } finally {
      secretKey.value.fill(0);
    }
  }
}
