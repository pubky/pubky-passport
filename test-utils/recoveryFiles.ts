/**
 * Bytes shaped like a recovery file: its spec line, then `bodyLength` bytes standing in for the
 * encrypted key. Only the start matters to the checks; decryption is faked where these are used.
 */
export function recoveryFileBytes(bodyLength = 72): Uint8Array {
  const specLine = new TextEncoder().encode("pubky.org/recovery\n");
  const bytes = new Uint8Array(specLine.byteLength + bodyLength).fill(7);
  bytes.set(specLine);
  return bytes;
}

/** A small file that is not a recovery file, e.g. notes picked by mistake. */
export function notARecoveryFileBytes(): Uint8Array {
  return new TextEncoder().encode("not a recovery file");
}
