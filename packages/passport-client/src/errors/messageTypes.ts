import type { PassportAction, PassportErrorCode } from "./PassportError.js";

export interface MessageContext {
  appName: string;
  instanceHost: string;
  defaultHost: string;
}
export type MessageTemplate = string | ((context: MessageContext) => string);
export type StateMessageKey =
  | `label.${"idle" | "opening" | "waiting" | "detached" | "redirecting" | "finishing" | "failed" | "unavailable" | "needs-profile" | "needs-profile.passport"}`
  | `status.${"opening" | "waiting" | "waiting.closed" | "waiting.unconfirmed" | "waiting.ring-closed" | "phase.ring" | "phase.granting" | "detached" | "detached.request-lost" | "redirecting" | "finishing" | "needs-profile" | "needs-profile.error" | "needs-profile.passport"}`
  | `action.${PassportAction}`
  | `ring.${"divider" | "preparing" | "open" | "qr-label" | "copy" | "copied" | "copy-failed" | "expired" | "reload"}`
  | `picker.${"toggle" | "input" | "confirm" | "use" | "reset"}`
  | `instance.${"instance_invalid" | "attempt_in_progress"}`
  | "error.passport_error.storage_unavailable"
  | "error.request_rejected.outdated"
  | "error.request_rejected.history_unavailable"
  | "notice.custom-instance"
  | "return.stray";
export type MessageKey = `error.${PassportErrorCode}` | StateMessageKey;
export type PassportMessageOverrides = Partial<Record<MessageKey, MessageTemplate>>;
