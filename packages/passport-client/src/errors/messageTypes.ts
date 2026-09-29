import type { PassportAction, PassportErrorCode } from "./PassportError.js";

export interface MessageContext {
  appName: string;
  instanceHost: string;
  defaultHost: string;
}
export type MessageTemplate = string | ((context: MessageContext) => string);
export type StateMessageKey =
  | `label.${"idle" | "opening" | "waiting" | "detached" | "blocked" | "redirecting" | "finishing" | "failed" | "unavailable" | "needs-profile"}`
  | `status.${"opening" | "waiting" | "waiting.closed" | "waiting.unconfirmed" | "waiting.ring-closed" | "phase.ring" | "phase.granting" | "detached" | "detached.request-lost" | "blocked" | "redirecting" | "finishing" | "needs-profile" | "needs-profile.error"}`
  | `action.${PassportAction}`
  | `ring.${"divider" | "preparing" | "qr-caption" | "qr-caption.during-attempt" | "open" | "show-qr" | "qr-label"}`
  | `picker.${"toggle" | "input" | "continue" | "confirm" | "use" | "cancel" | "reset"}`
  | `instance.${"instance_invalid" | "instance_not_allowed" | "attempt_in_progress"}`
  | "error.passport_error.storage_unavailable"
  | "error.request_rejected.outdated"
  | "notice.custom-instance"
  | "return.stray";
export type MessageKey = `error.${PassportErrorCode}` | StateMessageKey;
export type PassportMessageOverrides = Partial<Record<MessageKey, MessageTemplate>>;
