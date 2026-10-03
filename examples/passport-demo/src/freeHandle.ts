/** Frees an SDK handle without letting a failure mask the operation that used it. */
export function freeHandle(handle: { free(): void } | undefined): void {
  try {
    handle?.free();
  } catch {
    // Cleanup must not mask the original operation's failure.
  }
}
