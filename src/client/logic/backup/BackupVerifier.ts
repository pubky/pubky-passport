import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type { PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";

export const MAXIMUM_BACKUP_BYTES = 1024 * 1024;
/**
 * Minimum for passwords that protect a new backup. The SDK derives a recovery file's key with a
 * fixed salt, so the passphrase is the file's only protection against offline guessing.
 */
export const MINIMUM_BACKUP_PASSWORD_LENGTH = 12;
export const MAXIMUM_BACKUP_PASSWORD_LENGTH = 1024;

export type BackupInputErrorCode = "invalid_password" | "invalid_backup";
export type BackupVerificationErrorCode =
  BackupInputErrorCode | "backup_decryption_failed" | "backup_mismatch";
export type BackupVerificationResult = ResultType<void, CodedFailure<BackupVerificationErrorCode>>;

type BackupKeys = Pick<PubkySdkAdapter, "restoreRecoveryFile" | "disposeIdentityKey">;

/**
 * The spec lines a recovery file starts with: `pubky.org/recovery`, or `pkarr.org/recovery` in
 * files made by older tools, then a newline. From the pubky skill's concepts.md (observed in the
 * SDK's `recovery_file.rs`, not an upstream statement); the pinned SDK writes the first.
 */
const RECOVERY_FILE_SPEC_LINES = ["pubky.org/recovery\n", "pkarr.org/recovery\n"].map((line) =>
  new TextEncoder().encode(line),
);

/**
 * Whether `bytes` start like a recovery file. A file that does not can't be opened by any
 * password, so a failed decryption is then the wrong file, not a mistyped password.
 */
export function hasRecoveryFileSpecLine(bytes: Uint8Array): boolean {
  return RECOVERY_FILE_SPEC_LINES.some(
    (line) =>
      bytes.byteLength > line.byteLength && line.every((byte, index) => bytes[index] === byte),
  );
}

/** The name Passport gives a backup file of `publicKeyZ32`, e.g. `pubky-<key>.pkarr`. */
export function backupFileName(publicKeyZ32: string): string {
  return `pubky-${publicKeyZ32}.pkarr`;
}

/** Whether `password` may encrypt a new backup. */
export function isValidNewBackupPassword(password: string): boolean {
  return (
    password.length >= MINIMUM_BACKUP_PASSWORD_LENGTH &&
    password.length <= MAXIMUM_BACKUP_PASSWORD_LENGTH
  );
}

/**
 * Checks the input for opening an existing backup. Other Pubky tools accept any non-empty
 * passphrase, so the creation minimum does not apply when a file is only being opened.
 */
export function validateBackupInput(
  bytes: Uint8Array,
  password: string,
): BackupInputErrorCode | null {
  if (password.length === 0 || password.length > MAXIMUM_BACKUP_PASSWORD_LENGTH)
    return "invalid_password";
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAXIMUM_BACKUP_BYTES
  )
    return "invalid_backup";
  return null;
}

/** Decrypts a backup and checks its identity without signing in or storing its key. */
export class BackupVerifier {
  constructor(private readonly keys: BackupKeys) {}

  verify(bytes: Uint8Array, password: string, publicKey: string): BackupVerificationResult {
    try {
      const invalid = validateBackupInput(bytes, password);
      if (invalid) return Result.err({ code: invalid });
      // Read before decrypting, which clears the bytes.
      const recoveryFile = hasRecoveryFileSpecLine(bytes);
      const restored = this.keys.restoreRecoveryFile(bytes, password);
      if (Result.isError(restored))
        return Result.err({
          code: recoveryFile ? "backup_decryption_failed" : "invalid_backup",
          cause: restored.error,
        });
      try {
        return restored.value.publicIdentity.publicKeyZ32 === publicKey
          ? Result.ok()
          : Result.err({ code: "backup_mismatch" });
      } finally {
        this.keys.disposeIdentityKey(restored.value.keyHandle);
      }
    } finally {
      bytes.fill(0);
    }
  }
}

/**
 * Verifies a backup with a short-lived SDK adapter, for screens that hold no setup controller.
 * The file bytes are always cleared.
 */
export async function verifyBackupFile(
  bytes: Uint8Array,
  password: string,
  publicKey: string,
): Promise<ResultType<void, CodedFailure<BackupVerificationErrorCode | "verification_failed">>> {
  let pubky: PubkySdkAdapter | undefined;
  try {
    const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
    pubky = new PubkySdkAdapter();
    return new BackupVerifier(pubky).verify(bytes, password, publicKey);
  } catch (e) {
    LOGGER.warn("identity.backup.verify.failed", {
      operation: "verify_backup_file",
      ...safeErrorLogFields(e),
    });
    return Result.err({ code: "verification_failed", cause: e });
  } finally {
    bytes.fill(0);
    try {
      pubky?.dispose();
    } catch (e) {
      LOGGER.warn("identity.backup.cleanup.failed", {
        operation: "pubky_dispose",
        ...safeErrorLogFields(e),
      });
    }
  }
}
