import type { ResolvedClientOptions } from "../config/resolveClientOptions.js";
import { formatMessage } from "../errors/formatMessage.js";
import type { MessageContext } from "../errors/messageTypes.js";
import { createInstanceChoiceStore, type ChoiceStorage } from "./instanceChoiceStore.js";
import { validateInstanceOrigin, type InstanceInvalidDetail } from "./instanceOrigin.js";
import type { InstanceChangeResult, PassportInstance } from "./PassportInstance.js";

export class InstanceResolver {
  private readonly defaultInstance: PassportInstance;
  private readonly store: ReturnType<typeof createInstanceChoiceStore>;
  private notifying = false;

  constructor(
    private readonly options: ResolvedClientOptions,
    getStorage: () => ChoiceStorage,
    now: () => number = Date.now,
    private readonly messageContext?: () => Partial<MessageContext>,
  ) {
    this.defaultInstance = this.instance(options.instance, "default");
    this.store = createInstanceChoiceStore(
      options.instance,
      getStorage,
      () => this.ignored("malformed"),
      now,
    );
  }

  getInstance(): PassportInstance {
    if (!this.options.allowCustomInstance) return this.defaultInstance;
    const choice = this.store.read();
    if (choice === undefined) return this.defaultInstance;
    const checked = validateInstanceOrigin(choice);
    if (!checked.ok) {
      this.ignored("invalid");
      return this.defaultInstance;
    }
    if (!this.isAllowed(checked.origin)) {
      this.ignored("not_allowed");
      return this.defaultInstance;
    }
    return this.instance(checked.origin, "user");
  }

  setInstance(input: string): InstanceChangeResult {
    const checked = validateInstanceOrigin(input);
    if (!checked.ok)
      return this.failure("instance_invalid", this.getInstance().host, checked.detail);
    if (!this.options.allowCustomInstance)
      return checked.origin === this.options.instance
        ? { ok: true, instance: this.defaultInstance }
        : this.failure("instance_not_allowed", new URL(checked.origin).host);
    if (!this.isAllowed(checked.origin))
      return this.failure("instance_not_allowed", new URL(checked.origin).host);
    this.store.write(checked.origin);
    return { ok: true, instance: this.instance(checked.origin, "user") };
  }

  resetInstance(): void {
    this.store.clear();
  }

  private isAllowed(origin: string): boolean {
    return (
      origin === this.options.instance ||
      (this.options.allowCustomInstance &&
        (!this.options.allowedInstances || this.options.allowedInstances.includes(origin)))
    );
  }

  private instance(origin: string, source: PassportInstance["source"]): PassportInstance {
    return Object.freeze({
      origin,
      host: new URL(origin).host,
      source,
      isCustom: origin !== this.options.instance,
    });
  }

  private failure(
    code: "instance_invalid" | "instance_not_allowed",
    instanceHost: string,
    detail?: InstanceInvalidDetail,
  ): InstanceChangeResult {
    let context: Partial<MessageContext> = {};
    if (this.options.appName !== undefined) context.appName = this.options.appName;
    try {
      context = { ...context, ...this.messageContext?.() };
    } catch {
      /* Unavailable browser context must not turn a recoverable error into a throw. */
    }
    return {
      ok: false,
      code,
      ...(detail ? { detail } : {}),
      message: formatMessage(`instance.${code}`, this.options.messages, {
        ...context,
        instanceHost,
        defaultHost: this.defaultInstance.host,
      }),
    };
  }

  private ignored(reason: "malformed" | "invalid" | "not_allowed"): void {
    if (this.notifying) return;
    this.notifying = true;
    try {
      this.options.onDiagnostic?.(Object.freeze({ code: "instance_choice_ignored", reason }));
    } catch {
      /* A diagnostic observer must not change instance resolution. */
    } finally {
      this.notifying = false;
    }
  }
}
