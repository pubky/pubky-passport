// Best-effort cleanup of an owned handle. Never pass a consumed AuthFlowKind or
// EventStreamBuilder: freeing a consumed wrapper throws inside WASM and leaks its stack.
export function freeHandle(handle: { free(): void } | undefined) {
  try {
    handle?.free();
  } catch {
    // Cleanup must not mask the original operation's failure.
  }
}
