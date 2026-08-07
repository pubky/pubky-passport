import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LOGGER } from "../../../libs/logger/logger";
import type { DecryptPassportSecret } from "../../passport-file/passportFileWebCrypto";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStoreResult,
} from "../../passport-file/googleDrivePassportFileStore";
import type { VisibleRecoveryCopyDeletionResult } from "../../passport-file/googleDriveVisibleRecoveryCopyDeleter";
import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import type {
  GoogleWrappingKeyErrorCode,
  GoogleWrappingKeyResult,
} from "../../wrapping-key/wrappingKeyApiClient";
import type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";

export type GoogleIdentityBackupDeletionErrorCode =
  | "wrapping_key_failed"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "drive_stale_file"
  | "drive_delete_failed"
  | "unexpected_failure";

export type GoogleIdentityBackupDeletionError =
  | {
    code: Exclude<GoogleIdentityBackupDeletionErrorCode, "wrapping_key_failed">;
  }
  | {
    code: "wrapping_key_failed";
    cause: GoogleWrappingKeyErrorCode;
  };

export type GoogleIdentityBackupDeletionResult = ResultType<
  { status: "deleted" | "missing" },
  GoogleIdentityBackupDeletionError
>;

export class DeleteGoogleIdentityBackups {
  readonly #requestWrappingKey: (googleIdToken: string) => Promise<GoogleWrappingKeyResult>;
  readonly #readPassportFile: ReadPassportFile;
  readonly #deletePassportFileByReference: DeletePassportFileByReference;
  readonly #deleteVisibleRecoveryCopies: DeleteVisibleRecoveryCopies;
  readonly #decryptSecretKeyBytes: DecryptPassportSecret;
  readonly #pubky: PubkySdkAdapter;
  readonly #passportOrigin: string;

  constructor(input: {
    requestWrappingKey: (googleIdToken: string) => Promise<GoogleWrappingKeyResult>;
    readPassportFile: ReadPassportFile;
    deletePassportFileByReference: DeletePassportFileByReference;
    deleteVisibleRecoveryCopies: DeleteVisibleRecoveryCopies;
    decryptSecretKeyBytes: DecryptPassportSecret;
    pubky: PubkySdkAdapter;
    passportOrigin: string;
  }) {
    this.#requestWrappingKey = input.requestWrappingKey;
    this.#readPassportFile = input.readPassportFile;
    this.#deletePassportFileByReference = input.deletePassportFileByReference;
    this.#deleteVisibleRecoveryCopies = input.deleteVisibleRecoveryCopies;
    this.#decryptSecretKeyBytes = input.decryptSecretKeyBytes;
    this.#pubky = input.pubky;
    this.#passportOrigin = input.passportOrigin;
  }

  async deleteGoogleIdentityBackups(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<GoogleIdentityBackupDeletionResult> {
    if (credentials.googleAccount.id !== expectedGoogleAccountId) return failure("identity_mismatch");
    try {
      return await this.deleteVerifiedBackups(credentials, publicIdentity);
    } catch {
      LOGGER.warn("identity.google.delete.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async deleteVerifiedBackups(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<GoogleIdentityBackupDeletionResult> {
    const storedFile = await this.#readPassportFile(credentials.driveAccessToken);
    if (Result.isError(storedFile)) return failure("drive_read_failed");
    if (storedFile.value.status === "found") {
      const verified = await this.verifyPassportFile(credentials.googleIdToken, storedFile.value, publicIdentity.publicKeyZ32);
      if (Result.isError(verified)) return Result.err(verified.error);
    }

    const visibleCopies = await this.#deleteVisibleRecoveryCopies(
      credentials.driveAccessToken,
      publicIdentity.publicKeyDisplay,
    );
    if (Result.isError(visibleCopies)) return failure("drive_delete_failed");

    if (storedFile.value.status === "missing") return Result.ok({ status: "missing" });
    const deleted = await this.#deletePassportFileByReference(
      credentials.driveAccessToken,
      storedFile.value.reference,
    );
    return Result.isError(deleted)
      ? failure(deleted.error.code === "stale_file" ? "drive_stale_file" : "drive_delete_failed")
      : Result.ok({ status: "deleted" });
  }

  private async verifyPassportFile(
    googleIdToken: string,
    storedFile: Extract<PassportFileReadResult, { status: "found" }>,
    expectedPublicKeyZ32: string,
  ): Promise<ResultType<void, GoogleIdentityBackupDeletionError>> {
    const wrappingKey = await this.#requestWrappingKey(googleIdToken);
    if (Result.isError(wrappingKey)) {
      return Result.err({ code: "wrapping_key_failed", cause: wrappingKey.error.code });
    }
    const secretKey = await this.#decryptSecretKeyBytes({
      envelope: storedFile.envelope,
      wrappingKey: wrappingKey.value,
      passportOrigin: this.#passportOrigin,
    });
    if (Result.isError(secretKey)) return failure("decrypt_failed");

    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.#pubky.restoreIdentityKey({ bytes: secretKey.value, format: PUBKY_SECRET_KEY_FORMAT });
      if (Result.isError(restored)) return failure("restore_failed");
      restoredIdentity = restored.value;
      if (restored.value.publicIdentity.publicKeyZ32 !== expectedPublicKeyZ32) {
        LOGGER.warn("identity.google.delete.failed", { stage: "identity_validation", code: "identity_mismatch" });
        return failure("identity_mismatch");
      }
      return Result.ok(undefined);
    } finally {
      secretKey.value.fill(0);
      if (restoredIdentity) {
        try { this.#pubky.disposeIdentityKey(restoredIdentity.keyHandle); }
        catch { LOGGER.warn("identity.google.cleanup.failed", { operation: "deleted_key_dispose" }); }
      }
    }
  }
}

type ReadPassportFile = (driveAccessToken: string) => Promise<PassportFileStoreResult<PassportFileReadResult>>;
type DeletePassportFileByReference = (
  driveAccessToken: string,
  reference: PassportFileReference,
) => Promise<PassportFileStoreResult<void>>;
type DeleteVisibleRecoveryCopies = (
  driveAccessToken: string,
  publicKeyDisplay: string,
) => Promise<VisibleRecoveryCopyDeletionResult>;
function failure<T = { status: "deleted" | "missing" }>(
  code: Exclude<GoogleIdentityBackupDeletionErrorCode, "wrapping_key_failed">,
): ResultType<T, GoogleIdentityBackupDeletionError> {
  return Result.err({ code });
}
