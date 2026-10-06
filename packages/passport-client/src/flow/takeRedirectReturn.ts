import type { ReturnMarker } from "../attempt/attemptModel.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import type { ParsedReturnMarker } from "../protocol/parseReturnMarker.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import type { RedirectStateStore } from "./RedirectStateStore.js";
import type { RedirectRecord } from "./parseRedirectRecord.js";

type TakenReturn =
  | { kind: "none" | "stray" | "invalid"; diagnostic?: PassportDiagnostic }
  | { kind: "resume"; record: RedirectRecord; instance: PassportInstance; marker: ReturnMarker };

/** Consume and scrub before returning any private SDK state to the resume coordinator. */
export function takeRedirectReturn(
  store: Pick<RedirectStateStore, "read" | "consume">,
  marker: ParsedReturnMarker | undefined,
  scrub: () => void,
): TakenReturn {
  const slot = store.read();
  if (slot.kind === "foreign") return { kind: "none" };
  const consumed = slot.kind === "owned" && store.consume(slot.record);
  if (marker) {
    try {
      scrub();
    } catch {
      /* History failure cannot change consumption or permit a second resume. */
    }
  }
  if (slot.kind === "none") return { kind: marker ? "stray" : "none" };
  if (slot.kind === "owned") {
    if (consumed && slot.eligible && (!marker || marker.attemptId === slot.record.attemptId))
      return {
        kind: "resume",
        record: slot.record,
        instance: slot.instance,
        marker: marker?.kind ?? "none",
      };
    return {
      kind: marker ? "invalid" : "none",
      diagnostic: { code: "redirect_state_discarded", attemptId: slot.record.attemptId },
    };
  }
  return {
    kind: marker ? "invalid" : "none",
    diagnostic: { code: "redirect_state_discarded" },
  };
}
