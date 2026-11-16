import "client-only";

/** The extension of the recovery files Passport, pubky.app and Pubky Ring write. */
export const RECOVERY_FILE_EXTENSION = ".pkarr";

/** The SDK writes 91 bytes; anything far larger is not a recovery file. */
export const MAXIMUM_RECOVERY_FILE_BYTES = 1024;

/**
 * The spec lines a recovery file starts with, followed by a newline: the current one and the
 * legacy one older backups carry. The SDK accepts both.
 */
const RECOVERY_FILE_SPEC_LINES = ["pubky.org/recovery\n", "pkarr.org/recovery\n"] as const;

/** True when the bytes start with a recovery spec line and fit the size limit. */
export function hasRecoveryFileShape(recoveryFile: Uint8Array): boolean {
  if (
    !(recoveryFile instanceof Uint8Array) ||
    recoveryFile.byteLength > MAXIMUM_RECOVERY_FILE_BYTES
  ) {
    return false;
  }
  return RECOVERY_FILE_SPEC_LINES.some((specLine) => startsWithSpecLine(recoveryFile, specLine));
}

function startsWithSpecLine(recoveryFile: Uint8Array, specLine: string): boolean {
  if (recoveryFile.byteLength <= specLine.length) return false;
  for (let index = 0; index < specLine.length; index += 1) {
    if (recoveryFile[index] !== specLine.charCodeAt(index)) return false;
  }
  return true;
}
