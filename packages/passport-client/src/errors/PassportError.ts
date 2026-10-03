import type { PubkyErrorName } from "@synonymdev/pubky";
import { PassportErrorCause } from "./PassportErrorCause.js";
import { formatMessage, messageContext } from "./formatMessage.js";
import type { MessageContext, MessageKey, PassportMessageOverrides } from "./messageTypes.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
export { PassportErrorCause } from "./PassportErrorCause.js";

export type PassportErrorCode =
  | "popup_blocked"
  | "popup_closed"
  | "cancelled"
  | "passport_error"
  | "request_rejected"
  | "request_expired"
  | "request_ended"
  | "timeout"
  | "network"
  | "identity_unresolved"
  | "approval_rejected"
  | "capability_mismatch"
  | "profile_required"
  | "resume_failed"
  | "unsupported_environment"
  | "internal";
export type PassportAction =
  | "sign-in"
  | "focus"
  | "reopen"
  | "cancel"
  | "retry"
  | "use-default-instance"
  | "reset-instance"
  | "create-profile";

export interface PassportErrorDetail {
  by?: "user" | "app";
  passportCode?: string;
  /** Passport parser code, or "empty", for request_rejected. */
  rejection?: string;
  /** A popup_closed error before the attempt's handshake confirmed. */
  handshake?: "unconfirmed";
  sdkError?: PubkyErrorName;
  statusCode?: number;
}

export interface PassportErrorOptions {
  detail?: Readonly<PassportErrorDetail>;
  cause?: unknown;
  messages?: PassportMessageOverrides;
  context?: Partial<MessageContext>;
  instance?: Pick<PassportInstance, "host" | "isCustom">;
}

export function errorMessageKey(
  code: PassportErrorCode,
  detail?: Readonly<PassportErrorDetail>,
  isCustom = false,
): MessageKey {
  if (code === "passport_error" && detail?.passportCode === "storage_unavailable")
    return "error.passport_error.storage_unavailable";
  if (code === "request_rejected" && detail?.rejection === "history_unavailable")
    return "error.request_rejected.history_unavailable";
  if (code === "request_rejected" && detail?.rejection === "empty" && isCustom)
    return "error.request_rejected.outdated";
  return `error.${code}`;
}

export function errorAction(
  code: PassportErrorCode,
  detail?: Readonly<PassportErrorDetail>,
  isCustom = false,
): PassportAction | undefined {
  if (
    code === "unsupported_environment" ||
    // DESIGN §4.2: invalid ready replies do not retry, except browser history failure.
    (code === "request_rejected" &&
      detail?.rejection !== "empty" &&
      detail?.rejection !== "history_unavailable")
  )
    return undefined;
  if (code === "request_rejected" && detail?.rejection === "empty" && isCustom)
    return "use-default-instance";
  if (code === "cancelled" && detail?.by === "app") return "sign-in";
  return "retry";
}

export class PassportError extends Error {
  override readonly name = "PassportError";
  override readonly message: string;
  readonly code: PassportErrorCode;
  readonly detail?: Readonly<PassportErrorDetail>;
  override readonly cause?: PassportErrorCause;

  constructor(code: PassportErrorCode, options: PassportErrorOptions = {}) {
    const context = messageContext({
      ...options.context,
      ...(options.instance ? { instanceHost: options.instance.host } : {}),
    });
    const isCustom = options.instance?.isCustom ?? false;
    const key = errorMessageKey(code, options.detail, isCustom);
    const message = formatMessage(key, options.messages, context);
    super(message);
    this.message = message;
    this.code = code;
    if (options.detail) this.detail = Object.freeze({ ...options.detail });
    if (options.cause !== undefined) this.cause = new PassportErrorCause(options.cause);
  }
}
