import type { GrantAuthFlow, Session, XCallbackParams } from "@synonymdev/pubky";
import type { mapSdkError } from "../errors/mapSdkError.js";

/**
 * A native flow: a grant flow, or the legacy cookie flow (`classic QR`), which has no delegated
 * save, so a same-tab sign-in cannot resume it.
 */
export type FlowHandle = Pick<GrantAuthFlow, "authorizationUrl" | "tryPollOnce" | "free"> &
  Partial<Pick<GrantAuthFlow, "saveDelegated">>;
export type FlowCallbacks = Pick<XCallbackParams, "xSuccess" | "xCancel" | "xError">;
export type FlowResult<T> =
  { ok: true; value: T } | ({ ok: false } & ReturnType<typeof mapSdkError>);
export interface FlowSessionInfo {
  readonly publicKey: string;
  readonly capabilities: readonly string[];
}

export interface FlowPort {
  start(callbacks?: FlowCallbacks): Promise<FlowResult<FlowHandle>>;
  resume(saved: string): Promise<FlowResult<FlowHandle>>;
  sessionInfo(session: Session): FlowResult<FlowSessionInfo>;
}
