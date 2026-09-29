import type { PassportError } from "../errors/PassportError.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import type { RingLink } from "../shared/RingLink.js";

export type SignInVia = "popup" | "ring" | "redirect";
export type PassportPhase = "ring" | "granting";
interface AttemptBase {
  attemptId: string;
  instance: PassportInstance;
}
export type PassportState =
  | { status: "idle"; instance: PassportInstance; lastError?: PassportError }
  | { status: "preparing"; instance: PassportInstance; lastError?: PassportError }
  | { status: "ready"; instance: PassportInstance; ringLink: RingLink; lastError?: PassportError }
  | (AttemptBase & { status: "opening"; ringLink?: RingLink })
  | (AttemptBase & {
      status: "waiting";
      ringLink: RingLink;
      handshake: "confirmed" | "unconfirmed";
      phase?: PassportPhase;
      window: "open" | "closed";
    })
  | (AttemptBase & {
      status: "detached";
      ringLink: RingLink;
      reason: "unreachable" | "request-lost";
    })
  | (AttemptBase & { status: "blocked" })
  | (AttemptBase & { status: "redirecting" })
  | (AttemptBase & { status: "finishing"; via: SignInVia })
  | (AttemptBase & { status: "needs-profile"; publicKey: string; check: "missing" | "error" })
  | (AttemptBase & { status: "signed-in"; publicKey: string; via: SignInVia })
  | (AttemptBase & { status: "failed"; error: PassportError });
