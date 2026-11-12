import "client-only";

/** The extension of the recovery files Passport, pubky.app and Pubky Ring write. */
export const RECOVERY_FILE_EXTENSION = ".pkarr";

/** The SDK writes 91 bytes; anything far larger is not a recovery file. */
export const MAXIMUM_RECOVERY_FILE_BYTES = 1024;

/** The spec line every recovery file starts with, followed by a newline. */
const RECOVERY_FILE_SPEC_LINE = "pubky.org/recovery\n";

/** True when the bytes start with the recovery spec line and fit the size limit. */
export function hasRecoveryFileShape(recoveryFile: Uint8Array): boolean {
  if (
    !(recoveryFile instanceof Uint8Array) ||
    recoveryFile.byteLength <= RECOVERY_FILE_SPEC_LINE.length ||
    recoveryFile.byteLength > MAXIMUM_RECOVERY_FILE_BYTES
  ) {
    return false;
  }
  for (let index = 0; index < RECOVERY_FILE_SPEC_LINE.length; index += 1) {
    if (recoveryFile[index] !== RECOVERY_FILE_SPEC_LINE.charCodeAt(index)) return false;
  }
  return true;
}
