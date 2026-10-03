import type { ReturnMarker } from "../attempt/attemptModel.js";
import { ATTEMPT_ID } from "../shared/attemptId.js";

const MARKER = new RegExp(`^[sec]\\.${ATTEMPT_ID}$`, "u");

export interface ParsedReturnMarker {
  readonly kind: Exclude<ReturnMarker, "none">;
  readonly attemptId: string;
}

/** A navigation hint only; this never establishes a Session. */
export function parseReturnMarker(
  value: string | null | undefined,
): ParsedReturnMarker | undefined {
  if (typeof value !== "string" || !MARKER.test(value)) return undefined;
  return { kind: value[0] as ParsedReturnMarker["kind"], attemptId: value.slice(2) };
}
