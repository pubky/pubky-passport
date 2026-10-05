import type { PassportState } from "../attempt/attemptModel.js";
import { errorAction, errorMessageKey, type PassportAction } from "../errors/PassportError.js";
import { DEFAULT_MESSAGES } from "../errors/defaultMessages.js";
import { formatMessage } from "../errors/formatMessage.js";
import type {
  MessageContext,
  MessageKey,
  PassportMessageOverrides,
} from "../errors/messageTypes.js";

export interface ButtonView {
  hidden: boolean;
  label: string;
  status?: string;
  notice?: string;
  tone: "neutral" | "busy" | "warning" | "error" | "success";
  busy: boolean;
  primary: PassportAction | null;
  secondary: readonly PassportAction[];
  actionLabels: Readonly<Record<PassportAction, string>>;
}

/** `context.defaultHost` names the app's own Passport in the reset action. */
export function describePassportState(
  state: PassportState,
  messages?: PassportMessageOverrides,
  context?: Partial<MessageContext>,
): ButtonView {
  const text = (key: MessageKey) =>
    formatMessage(key, messages, { ...context, instanceHost: state.instance.host });
  const hidden = state.status === "signed-in";
  const actionLabels = Object.fromEntries(
    Object.keys(DEFAULT_MESSAGES)
      .filter((key) => key.startsWith("action."))
      .map((key) => [key.slice(7), text(key as MessageKey)]),
  ) as Record<PassportAction, string>;
  // A chosen Passport is reset to the app's own; that one offers the default instead.
  const reset: PassportAction[] = state.instance.isCustom ? ["reset-instance"] : [];
  const useDefault: PassportAction[] = state.instance.isCustom ? ["use-default-instance"] : [];
  const busy = ["opening", "waiting", "detached", "redirecting", "finishing"].includes(
    state.status,
  );
  const make = (
    label: MessageKey | null,
    status: MessageKey | undefined,
    primary: PassportAction | null,
    secondary: PassportAction[],
    tone: ButtonView["tone"] = busy ? "busy" : "neutral",
  ): ButtonView => ({
    hidden,
    label: label ? text(label) : "",
    ...(status ? { status: text(status) } : {}),
    ...(!hidden && state.instance.isCustom ? { notice: text("notice.custom-instance") } : {}),
    primary,
    secondary,
    tone,
    busy,
    actionLabels,
  });
  switch (state.status) {
    case "idle":
    case "preparing":
    case "ready": {
      const error = state.lastError;
      const show = error && !(error.code === "cancelled" && error.detail?.by === "app");
      return make(
        "label.idle",
        show ? errorMessageKey(error.code, error.detail, state.instance.isCustom) : undefined,
        "sign-in",
        reset,
        show ? "error" : "neutral",
      );
    }
    case "opening":
      return make("label.opening", "status.opening", "focus", ["cancel"]);
    case "waiting": {
      const cancel: PassportAction[] = state.phase === "granting" ? [] : ["cancel"];
      if (state.window === "closed") {
        if (state.phase === "ring")
          return make("label.waiting", "status.waiting.ring-closed", "reopen", ["cancel"]);
        return make("label.waiting", "status.waiting.closed", "reopen", [
          ...cancel,
          ...(state.handshake === "unconfirmed" ? useDefault : []),
        ]);
      }
      if (state.handshake === "unconfirmed")
        return make(
          "label.waiting",
          "status.waiting.unconfirmed",
          "reopen",
          [...cancel, ...useDefault],
          "warning",
        );
      if (state.phase === "granting")
        return make("label.waiting", "status.phase.granting", "focus", []);
      return make(
        "label.waiting",
        state.phase === "ring" ? "status.phase.ring" : "status.waiting",
        "focus",
        ["cancel"],
      );
    }
    case "detached":
      return make(
        "label.detached",
        state.reason === "request-lost" ? "status.detached.request-lost" : "status.detached",
        "reopen",
        ["cancel", ...(state.reason === "unreachable" ? useDefault : [])],
        "warning",
      );
    case "redirecting":
      return make("label.redirecting", "status.redirecting", null, []);
    case "finishing":
      return make("label.finishing", "status.finishing", null, []);
    case "signed-in":
      return make(null, undefined, null, [], "success");
    case "needs-profile":
      // Passport's window is open on the profile: the button brings it forward.
      if (state.passport === "open")
        return make(
          "label.needs-profile.passport",
          "status.needs-profile.passport",
          "focus",
          ["cancel"],
          "warning",
        );
      return make(
        "label.needs-profile",
        state.check === "error" ? "status.needs-profile.error" : "status.needs-profile",
        "create-profile",
        ["cancel"],
        "warning",
      );
    case "failed": {
      const { code, detail } = state.error;
      if (code === "cancelled" && detail?.by === "app")
        return make("label.idle", undefined, "sign-in", reset, "neutral");
      const action = errorAction(code, detail, state.instance.isCustom);
      const secondary: PassportAction[] = action === "use-default-instance" ? ["retry"] : [];
      if (code === "popup_closed" && detail?.handshake === "unconfirmed")
        secondary.push(...useDefault);
      return make(
        action ? "label.failed" : "label.unavailable",
        errorMessageKey(code, detail, state.instance.isCustom),
        action ?? null,
        [...secondary, ...reset],
        code === "cancelled" ? "neutral" : "error",
      );
    }
  }
}
