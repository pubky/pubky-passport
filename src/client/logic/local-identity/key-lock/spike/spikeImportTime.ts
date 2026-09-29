/** Kept in a separate chunk to exercise a real dynamic import on the first I click. */
export function spikeImportTime(): number {
  return performance.now();
}
