import { DEFAULT_MESSAGES } from "./defaultMessages.js";
import type {
  MessageContext,
  MessageKey,
  MessageTemplate,
  PassportMessageOverrides,
} from "./messageTypes.js";
import { DEFAULT_PASSPORT_HOST } from "../shared/defaults.js";

export function messageContext(context: Partial<MessageContext> = {}): MessageContext {
  context = context ?? {};
  const host = (value: unknown) =>
    typeof value === "string" && value ? value : DEFAULT_PASSPORT_HOST;
  return {
    appName: typeof context.appName === "string" ? context.appName : "",
    instanceHost: host(context.instanceHost),
    defaultHost: host(context.defaultHost),
  };
}

export function formatMessage(
  key: MessageKey,
  overrides?: PassportMessageOverrides,
  context?: Partial<MessageContext>,
): string {
  const complete = Object.freeze(messageContext(context));
  const render = (template: MessageTemplate) =>
    typeof template === "function"
      ? template(complete)
      : template.replace(
          /\{(appName|instanceHost|defaultHost)\}/gu,
          (_, field: keyof MessageContext) => complete[field],
        );
  let output: string;
  try {
    output = render(overrides?.[key] ?? DEFAULT_MESSAGES[key]);
    if (typeof output !== "string") output = render(DEFAULT_MESSAGES[key]);
  } catch {
    output = render(DEFAULT_MESSAGES[key]);
  }
  if (
    (key === "notice.custom-instance" || key === "picker.confirm") &&
    !hasHostToken(output, complete.instanceHost)
  )
    output += ` ${complete.instanceHost}`;
  return output;
}

function hasHostToken(text: string, host: string): boolean {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9.-])${escaped}(?![a-z0-9-]|\\.[a-z0-9]|:[0-9])`, "iu").test(text);
}
