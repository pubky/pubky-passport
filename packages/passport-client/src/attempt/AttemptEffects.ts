import type { FlowCallbacks } from "../flow/FlowPort.js";
import type { FlowRegistry } from "../flow/FlowRegistry.js";
import type { ProfileRead } from "../profile/PassportProfile.js";
import type { PopupPort } from "../popup/PopupPort.js";
import { PassportChannel } from "../protocol/PassportChannel.js";
import { requestDigest } from "../shared/requestDigest.js";
import type { Clock } from "../shared/Clock.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import type { AttemptCommand, AttemptEffectPort } from "./AttemptEffectPort.js";
import type { AttemptEvent } from "./attemptModel.js";

export type RedirectCommand = Extract<
  AttemptCommand,
  { type: "SaveStateAndNavigate" | "ResumeFlow" | "DeleteRedirectState" }
>;
interface EffectOptions {
  flows: FlowRegistry;
  popup: PopupPort;
  profile: "required" | "optional";
  readProfile(publicKey: string): Promise<ProfileRead>;
  event(
    event:
      | Extract<
          AttemptEvent,
          {
            type:
              | "READY"
              | "STATUS"
              | "OUTCOME"
              | "PROFILE_READY"
              | "PROFILE_FOUND"
              | "PROFILE_MISSING"
              | "PROFILE_CHECK_FAILED";
          }
        >
      | { type: "POPUP_CLOSED" },
  ): void;
  diagnostic?(diagnostic: PassportDiagnostic): void;
  /** Internal caller maps the cause before any public state or notification. */
  failed(cause: unknown): void;
  redirect(command: RedirectCommand): void;
  /** The callbacks that bring a same-tab sign-in for this attempt back to the page. */
  returnCallbacks(attemptId: string): FlowCallbacks;
  appWindow?: () => Window;
  clock?: Clock;
}
/** How long a profile read may take before it counts as failed. */
export const PROFILE_READ_MS = 15_000;
interface Watch {
  cancel(): void;
}
interface Channel {
  attemptId: string;
  value: PassportChannel;
}

/** Executes model commands; the synchronous facade alone may open windows. */
export class AttemptEffects implements AttemptEffectPort {
  #watch: Watch | undefined;
  #popup: Window | undefined;
  #channel: Channel | undefined;
  #profile: object | undefined;
  #disposed = false;
  constructor(private readonly options: EffectOptions) {}

  run(command: AttemptCommand): void {
    if (this.#disposed) return;
    const { flows, popup, redirect } = this.options;
    switch (command.type) {
      case "CheckProfile":
        void this.checkProfile(command);
        return;
      case "CreateFlow":
        return flows.create(
          command.flowId,
          command.instance,
          command.returnTo === undefined
            ? undefined
            : this.options.returnCallbacks(command.returnTo),
        );
      case "StartPolling":
        return flows.start(command.flowId);
      case "RetireFlow":
        return flows.retire(command.flowId, command.ms);
      case "FreeFlow":
        return flows.free(command.flowId);
      case "NavigatePopup": {
        const instance = flows.instance(command.flowId);
        if (!instance || instance.origin !== command.origin)
          throw new Error("Passport window navigation failed");
        const url = flows.authorizationUrl(command.flowId);
        if (url === undefined || !popup.navigate(command.popup, instance, url))
          throw new Error("Passport window navigation failed");
        return;
      }
      case "WatchPopup":
        return this.watch(command.popup);
      case "ClosePopup":
        // Closing the watched window ends its watch, so the attempt's end does not close it again.
        if (command.popup === this.#popup) {
          this.#popup = undefined;
          this.stopWatch();
        }
        return popup.close(command.popup);
      case "FocusPopup":
        return popup.focus(command.popup);
      case "StartHandshake": {
        // A40: the hello names the exact request by digest; Passport binds only on a match.
        // The pin is checked before the private URL is read, as for navigation.
        if (flows.instance(command.flowId)?.origin !== command.origin)
          throw new Error("Passport flow is unavailable");
        const url = flows.authorizationUrl(command.flowId);
        if (url === undefined) throw new Error("Passport flow is unavailable");
        return this.channel(command.attemptId).startHandshake(
          command.popup,
          command.origin,
          requestDigest(url),
        );
      }
      case "StartProfileHandshake":
        // No request here: the hello names the key whose profile Passport is to create.
        return this.channel(command.attemptId).startProfileHandshake(
          command.popup,
          command.origin,
          command.publicKey,
        );
      case "ProfileNeeded":
        return this.#channel?.value.profileNeeded(command.publicKey);
      case "StopHandshake":
        return this.#channel?.value.stopHandshake();
      case "SlowHandshake":
        return this.#channel?.value.slowHandshake();
      case "StartHeartbeat":
        return this.#channel?.value.startHeartbeat();
      case "StopHeartbeat":
        return this.#channel?.value.stopHeartbeat();
      case "Ack":
        return this.#channel?.value.ack(command.messageId, command.version);
      case "EndAttempt":
        this.endBrowser();
        return redirect({ type: "DeleteRedirectState" });
      case "SaveStateAndNavigate":
      case "ResumeFlow":
      case "DeleteRedirectState":
        return redirect(command);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.endBrowser();
    cleanup(() => this.options.redirect({ type: "DeleteRedirectState" }));
    cleanup(() => this.options.popup.dispose());
    this.options.flows.dispose();
  }

  private watch(popup: Window): void {
    this.stopWatch();
    // A fresh flow may still be in creation: stop accepting the replaced window now.
    this.#channel?.value.unbind();
    this.#popup = popup;
    const watch: Watch = { cancel: () => {} };
    this.#watch = watch;
    try {
      const cancel = this.options.popup.watch(
        popup,
        () => {
          if (this.#watch !== watch) return;
          this.stopWatch();
          this.options.event({ type: "POPUP_CLOSED" });
        },
        (cause) => {
          if (this.#watch !== watch) return;
          this.stopWatch();
          this.options.failed(cause);
        },
      );
      // The native port may synchronously report closure before returning its cleanup.
      if (this.#watch === watch) watch.cancel = cancel;
      else cleanup(cancel);
    } catch (e) {
      if (this.#watch === watch) this.stopWatch();
      throw e;
    }
  }

  private channel(attemptId: string): PassportChannel {
    if (this.#channel?.attemptId === attemptId) return this.#channel.value;
    this.stopChannel();
    const channel: Channel = {
      attemptId,
      value: new PassportChannel(
        attemptId,
        this.options.profile,
        this.options.popup,
        {
          event: (event) => {
            if (this.#channel === channel) this.options.event(event);
          },
          diagnostic: (value) => {
            if (this.#channel === channel) this.options.diagnostic?.(value);
          },
          failed: (cause) => {
            if (this.#channel === channel) this.options.failed(cause);
          },
        },
        this.options.appWindow,
        this.options.clock,
      ),
    };
    this.#channel = channel;
    return channel.value;
  }

  private stopWatch(): void {
    const watch = this.#watch;
    this.#watch = undefined;
    cleanup(() => watch?.cancel());
  }
  private stopChannel(): void {
    const channel = this.#channel;
    this.#channel = undefined;
    channel?.value.dispose();
  }
  private endBrowser(): void {
    this.#profile = undefined;
    const popup = this.#popup;
    this.#popup = undefined;
    this.stopWatch();
    this.stopChannel();
    if (popup) cleanup(() => this.options.popup.close(popup));
  }

  private async checkProfile(
    command: Extract<AttemptCommand, { type: "CheckProfile" }>,
  ): Promise<void> {
    if (this.#profile) return;
    const token = {};
    this.#profile = token;
    let result: ProfileRead;
    let cancelDeadline: (() => void) | undefined;
    try {
      // A read that never settles would hold the Session forever; it counts as a failed read.
      const deadline = new Promise<ProfileRead>((resolve) => {
        cancelDeadline = this.options.clock?.schedule(
          () => resolve({ kind: "error" }),
          PROFILE_READ_MS,
        );
      });
      result = await Promise.race([this.options.readProfile(command.publicKey), deadline]);
    } catch {
      result = { kind: "error" };
    } finally {
      cleanup(() => cancelDeadline?.());
    }
    if (this.#disposed || this.#profile !== token) return;
    this.#profile = undefined;
    try {
      this.options.event(
        result.kind === "found"
          ? { type: "PROFILE_FOUND", sessionId: command.sessionId, profile: result.profile }
          : {
              type: result.kind === "missing" ? "PROFILE_MISSING" : "PROFILE_CHECK_FAILED",
              sessionId: command.sessionId,
            },
      );
    } catch (e) {
      cleanup(() => this.options.failed(e));
    }
  }
}

function cleanup(operation: () => void): void {
  try {
    operation();
  } catch {
    /* Best-effort browser cleanup cannot strand another resource. */
  }
}
