import "client-only";

import { Result } from "better-result";

import { pubkySecretKeyFormat, type PubkyIdentityKey } from "../../pubky/ports";
import { logger } from "../../../libs/logger/logger";
import type { PassportFileCrypto, PassportFileStore } from "../../passport-file/ports";
import type { PubkyIdentityKeys } from "../../pubky/ports";
import type {
  GoogleDriveIdentityDeleter,
  GoogleDriveIdentityDeletionErrorCode,
  GoogleDriveIdentityDeletionResult,
  GoogleIdentitySession,
} from "./ports/google/googleIdentity";
import type { GoogleWrappingKeyRequester } from "./ports/google/googleWrappingKey";

export class DeleteGoogleDriveIdentity implements GoogleDriveIdentityDeleter {
  readonly #wrappingKeys: GoogleWrappingKeyRequester;
  readonly #passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #passportUrl: string;

  constructor(input: {
    wrappingKeys: GoogleWrappingKeyRequester;
    passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    passportUrl: string;
  }) {
    this.#wrappingKeys = input.wrappingKeys;
    this.#passportFilesForAccessToken = input.passportFilesForAccessToken;
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#passportUrl = input.passportUrl;
  }

  async execute(google: GoogleIdentitySession, expectedPublicKeyZ32: string): Promise<GoogleDriveIdentityDeletionResult> {
    try {
      return await this.deleteIdentity(google, expectedPublicKeyZ32);
    } catch {
      logger.warn("identity.google.delete.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async deleteIdentity(google: GoogleIdentitySession, expectedPublicKeyZ32: string): Promise<GoogleDriveIdentityDeletionResult> {
    const wrappingKey = await this.#wrappingKeys.requestWrappingKey({ googleIdToken: google.googleIdToken });
    if (Result.isError(wrappingKey)) return failure("wrapping_key_failed");

    const passportFiles = this.#passportFilesForAccessToken(google.driveAccessToken);
    const storedFile = await passportFiles.readPassportFile();
    if (Result.isError(storedFile)) return failure("drive_read_failed");
    if (storedFile.value.status === "missing") return Result.ok();

    const secretKey = await this.#crypto.decryptSecretKeyBytes({
      envelope: storedFile.value.envelope,
      wrappingKey: wrappingKey.value,
      passportUrl: this.#passportUrl,
    });
    if (Result.isError(secretKey)) return failure("decrypt_failed");

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#identityKeys.restoreIdentityKey({
        secretKey: { bytes: secretKey.value, format: pubkySecretKeyFormat },
      });
      if (Result.isError(restored)) return failure("restore_failed");
      restoredIdentity = restored.value;

      if (restored.value.publicIdentity.publicKeyZ32 !== expectedPublicKeyZ32) return failure("identity_mismatch");
    } finally {
      secretKey.value.fill(0);
      if (restoredIdentity) {
        try {
          this.#identityKeys.disposeIdentityKey({ keyHandle: restoredIdentity.keyHandle });
        } catch {
          logger.warn("identity.google.cleanup.failed", { operation: "deleted_key_dispose" });
        }
      }
    }

    const deleted = await passportFiles.deletePassportFile({ reference: storedFile.value.reference });
    if (Result.isError(deleted)) {
      return failure(deleted.error.code === "stale_file" ? "drive_stale_file" : "drive_delete_failed");
    }
    return Result.ok();
  }
}

function failure(code: GoogleDriveIdentityDeletionErrorCode): GoogleDriveIdentityDeletionResult {
  return Result.err({ code });
}
