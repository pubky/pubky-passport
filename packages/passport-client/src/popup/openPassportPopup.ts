import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import type { PopupPort, PopupRequest } from "./PopupPort.js";

export type PopupOpenResult = (
  { kind: "live"; popup: Window } | { kind: "blocked" | "unreachable" }
) & { diagnostic?: PassportDiagnostic };

/** Completes both native calls in the click stack, before flow creation or observers. */
export function openPassportPopup(
  port: PopupPort,
  request: PopupRequest,
  userActivation?: boolean,
): PopupOpenResult {
  const first = open(port, request, "named");
  const retried = first === undefined;
  const popup = retried ? open(port, request, "blank") : first;
  return {
    ...(popup ? { kind: "live", popup } : { kind: retried ? "unreachable" : "blocked" }),
    ...(userActivation === false
      ? { diagnostic: { code: "no_user_activation", attemptId: request.attemptId } }
      : {}),
  };
}

function open(
  port: PopupPort,
  request: PopupRequest,
  target: "named" | "blank",
): Window | null | undefined {
  try {
    const popup = port.open(request, target);
    return popup && port.isClosed(popup) ? null : popup;
  } catch {
    // Browser exceptions can contain request material and are never forwarded.
    return null;
  }
}
