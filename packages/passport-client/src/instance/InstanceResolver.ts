import type { ResolvedClientOptions } from "../config/resolveClientOptions.js";
import { formatMessage } from "../errors/formatMessage.js";
import type { MessageContext } from "../errors/messageTypes.js";
import { createInstanceChoiceStore, type ChoiceStorage } from "./instanceChoiceStore.js";
import { validateInstanceOrigin } from "./instanceOrigin.js";
import type { InstanceChangeResult, PassportInstance } from "./PassportInstance.js";

/** The app's own Passport, or the one the person chose for this app in this browser. */
export class InstanceResolver {
  private readonly defaultInstance: PassportInstance;
  private readonly store: ReturnType<typeof createInstanceChoiceStore>;

  constructor(
    private readonly options: ResolvedClientOptions,
    getStorage: () => ChoiceStorage,
    private readonly messageContext?: () => Partial<MessageContext>,
  ) {
    this.defaultInstance = this.instance(options.instance);
    this.store = createInstanceChoiceStore(options.instance, getStorage);
  }

  getInstance(): PassportInstance {
    const choice = this.store.read();
    if (choice === undefined) return this.defaultInstance;
    const checked = validateInstanceOrigin(choice);
    if (checked.ok) return this.instance(checked.origin);
    // A choice that no longer validates is dropped, and the app's own Passport is used.
    this.store.clear();
    try {
      this.options.onDiagnostic?.(Object.freeze({ code: "instance_choice_ignored" }));
    } catch {
      /* A diagnostic observer must not change instance resolution. */
    }
    return this.defaultInstance;
  }

  setInstance(input: string): InstanceChangeResult {
    const checked = validateInstanceOrigin(input);
    if (!checked.ok) {
      let context: Partial<MessageContext> = {};
      if (this.options.appName !== undefined) context.appName = this.options.appName;
      try {
        context = { ...context, ...this.messageContext?.() };
      } catch {
        /* Unavailable browser context must not turn a recoverable error into a throw. */
      }
      return {
        ok: false,
        code: "instance_invalid",
        detail: checked.detail,
        message: formatMessage("instance.instance_invalid", this.options.messages, {
          ...context,
          instanceHost: this.getInstance().host,
          defaultHost: this.defaultInstance.host,
        }),
      };
    }
    // Choosing the app's own Passport is the same as resetting the choice.
    if (checked.origin === this.options.instance) this.store.clear();
    else this.store.write(checked.origin);
    return { ok: true, instance: this.instance(checked.origin) };
  }

  resetInstance(): void {
    this.store.clear();
  }

  private instance(origin: string): PassportInstance {
    return Object.freeze({
      origin,
      host: new URL(origin).host,
      isCustom: origin !== this.options.instance,
    });
  }
}
