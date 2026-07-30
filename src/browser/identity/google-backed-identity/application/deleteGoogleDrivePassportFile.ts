import "client-only";

import { Result } from "better-result";

import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
} from "../../../pubky/application/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../../pubky/adapters/pubkySdkAdapter";
import { LOGGER } from "../../../../libs/logger/logger";
import type { DecryptPassportSecret } from "../../../passport-file/application/passportFileCryptoResults";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStoreResult,
} from "../../../passport-file/application/passportFileStoreModels";
import type {
  GoogleDrivePassportFileDeletionErrorCode,
  GoogleDrivePassportFileDeletionResult,
  GoogleBackedIdentityCredentials,
} from "./googleBackedIdentity";
import type { GoogleWrappingKeyResult } from "../../../wrapping-key/wrappingKeyApiClient";

export class DeleteGoogleDrivePassportFile {
  readonly #requestWrappingKey: (googleIdToken: string) => Promise<GoogleWrappingKeyResult>;
  readonly #readPassportFile: ReadPassportFile;
  readonly #deletePassportFile: DeletePassportFile;
  readonly #decryptSecretKeyBytes: DecryptPassportSecret;
  readonly #pubky: PubkySdkAdapter;
  readonly #passportOrigin: string;

  constructor(input: {
    requestWrappingKey: (googleIdToken: string) => Promise<GoogleWrappingKeyResult>;
    readPassportFile: ReadPassportFile;
    deletePassportFile: DeletePassportFile;
    decryptSecretKeyBytes: DecryptPassportSecret;
    pubky: PubkySdkAdapter;
    passportOrigin: string;
  }) {
    this.#requestWrappingKey = input.requestWrappingKey;
    this.#readPassportFile = input.readPassportFile;
    this.#deletePassportFile = input.deletePassportFile;
    this.#decryptSecretKeyBytes = input.decryptSecretKeyBytes;
    this.#pubky = input.pubky;
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
    const wrappingKey = await this.#requestWrappingKey(credentials.googleIdToken);
    if (Result.isError(wrappingKey)) {
      return Result.err({ code: "wrapping_key_failed", cause: wrappingKey.error.code });
    }

    const storedFile = await this.#readPassportFile(credentials.driveAccessToken);
    if (Result.isError(storedFile)) return failure("drive_read_failed");
    if (storedFile.value.status === "missing") return Result.ok();

    const secretKey = await this.#decryptSecretKeyBytes({
      envelope: storedFile.value.envelope,
      wrappingKey: wrappingKey.value,
      passportOrigin: this.#passportOrigin,
    });
    if (Result.isError(secretKey)) return failure("decrypt_failed");

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#pubky.restoreIdentityKey({ bytes: secretKey.value, format: PUBKY_SECRET_KEY_FORMAT });
      if (Result.isError(restored)) return failure("restore_failed");
      restoredIdentity = restored.value;

      if (restored.value.publicIdentity.publicKeyZ32 !== expectedPublicKeyZ32) return failure("identity_mismatch");
    } finally {
      secretKey.value.fill(0);
      if (restoredIdentity) {
        try {
          this.#pubky.disposeIdentityKey(restoredIdentity.keyHandle);
        } catch {
          LOGGER.warn("identity.google.cleanup.failed", { operation: "deleted_key_dispose" });
        }
      }
    }

    const deleted = await this.#deletePassportFile(credentials.driveAccessToken, storedFile.value.reference);
    if (Result.isError(deleted)) {
      return failure(deleted.error.code === "stale_file" ? "drive_stale_file" : "drive_delete_failed");
    }
    return Result.ok();
  }
}

type ReadPassportFile = (driveAccessToken: string) => Promise<PassportFileStoreResult<PassportFileReadResult>>;
type DeletePassportFile = (
  driveAccessToken: string,
  reference: PassportFileReference,
) => Promise<PassportFileStoreResult<void>>;
function failure(
  code: Exclude<GoogleDrivePassportFileDeletionErrorCode, "wrapping_key_failed">,
): GoogleDrivePassportFileDeletionResult {
  return Result.err({ code });
}
