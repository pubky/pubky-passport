import "client-only";

import { Result } from "better-result";

import { PUBKY_SECRET_KEY_FORMAT, type PubkyIdentityKey, type PubkyIdentityKeys } from "../../../pubky/application/pubkyIdentityKeys";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileCrypto } from "../../../passport-file/application/passportFileCrypto";
import type { PassportFileStore } from "../../../passport-file/application/passportFileStore";
import type {
  GoogleDrivePassportFileDeletionErrorCode,
  GoogleDrivePassportFileDeletionResult,
  GoogleBackedIdentityCredentials,
} from "./googleBackedIdentity";
import type { GoogleWrappingKeyRequester } from "../wrapping-key/application/googleWrappingKey";

export class DeleteGoogleDrivePassportFile {
  readonly #wrappingKeyRequester: GoogleWrappingKeyRequester;
  readonly #passportFileStoreForAccessToken: (driveAccessToken: string) => PassportFileStore;
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #passportOrigin: string;

  constructor(input: {
    wrappingKeyRequester: GoogleWrappingKeyRequester;
    passportFileStoreForAccessToken: (driveAccessToken: string) => PassportFileStore;
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    passportOrigin: string;
  }) {
    this.#wrappingKeyRequester = input.wrappingKeyRequester;
    this.#passportFileStoreForAccessToken = input.passportFileStoreForAccessToken;
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#passportOrigin = input.passportOrigin;
  }

  async deleteGoogleDrivePassportFile(
    credentials: GoogleBackedIdentityCredentials,
    expectedPublicKeyZ32: string,
  ): Promise<GoogleDrivePassportFileDeletionResult> {
    try {
      return await this.deletePassportFile(credentials, expectedPublicKeyZ32);
    } catch {
      LOGGER.warn("identity.google.delete.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async deletePassportFile(credentials: GoogleBackedIdentityCredentials, expectedPublicKeyZ32: string): Promise<GoogleDrivePassportFileDeletionResult> {
    const wrappingKey = await this.#wrappingKeyRequester.requestWrappingKey({ googleIdToken: credentials.googleIdToken });
    if (Result.isError(wrappingKey)) return failure("wrapping_key_failed");

    const passportFileStore = this.#passportFileStoreForAccessToken(credentials.driveAccessToken);
    const storedFile = await passportFileStore.readPassportFile();
    if (Result.isError(storedFile)) return failure("drive_read_failed");
    if (storedFile.value.status === "missing") return Result.ok();

    const secretKey = await this.#crypto.decryptSecretKeyBytes({
      envelope: storedFile.value.envelope,
      wrappingKey: wrappingKey.value,
      passportOrigin: this.#passportOrigin,
    });
    if (Result.isError(secretKey)) return failure("decrypt_failed");

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#identityKeys.restoreIdentityKey({
        secretKey: { bytes: secretKey.value, format: PUBKY_SECRET_KEY_FORMAT },
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
          LOGGER.warn("identity.google.cleanup.failed", { operation: "deleted_key_dispose" });
        }
      }
    }

    const deleted = await passportFileStore.deletePassportFile({ reference: storedFile.value.reference });
    if (Result.isError(deleted)) {
      return failure(deleted.error.code === "stale_file" ? "drive_stale_file" : "drive_delete_failed");
    }
    return Result.ok();
  }
}

function failure(code: GoogleDrivePassportFileDeletionErrorCode): GoogleDrivePassportFileDeletionResult {
  return Result.err({ code });
}
