import type { AttemptEvent } from "../attempt/attemptModel.js";
import type { PubkyNetwork } from "../config/networkOptions.js";
import type { PopupPort } from "../popup/PopupPort.js";
import { systemClock, type Clock } from "../shared/Clock.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import {
  isPassportMessage,
  parsePassportMessage,
  PROFILE_SETUP_FEATURE,
} from "./passportMessages.js";

export interface ChannelObserver {
  event(
    event: Extract<AttemptEvent, { type: "READY" | "STATUS" | "OUTCOME" | "PROFILE_READY" }>,
  ): void;
  diagnostic?(diagnostic: PassportDiagnostic): void;
  /** Internal boundary: the controller maps this cause before notifying the app. */
  failed?(cause: unknown): void;
}
interface Binding {
  readonly popup: Window;
  readonly origin: string;
  /** The hello names what it binds to: the request's digest, or the profile's key. */
  readonly match: { readonly request: string } | { readonly profileKey: string };
}
interface Loop {
  readonly mode: "handshake" | "heartbeat";
  readonly binding: Binding;
  readonly ms: number;
  cancel(): void;
}

/** One listener and first-outcome authority per attempt, across popup replacements. */
export class PassportChannel {
  private binding: Binding | undefined;
  private loop: Loop | undefined;
  private listening: Window | undefined;
  private disposed = false;
  private outcomeReceived = false;
  constructor(
    private readonly attemptId: string,
    private readonly profile: "required" | "optional",
    private readonly port: Pick<PopupPort, "post">,
    private readonly observer: ChannelObserver,
    private readonly appWindow: () => Window = () => window,
    private readonly clock: Clock = systemClock,
    /** Named in every hello; a Passport on another network refuses the request. */
    private readonly network: PubkyNetwork = "mainnet",
  ) {}

  startHandshake(popup: Window, origin: string, request: string): void {
    this.bind({ popup, origin, match: { request } });
  }
  /** Passport's profile setup page for `profileKey`, reopened for a held Session. */
  startProfileHandshake(popup: Window, origin: string, profileKey: string): void {
    this.bind({ popup, origin, match: { profileKey } });
  }
  /** Asks the bound Passport to create the missing profile of the held Session's key. */
  profileNeeded(publicKey: string): void {
    if (!this.binding || this.disposed) return;
    this.post(this.binding, {
      type: "pubky-passport.profile-needed",
      version: 2,
      attemptId: this.attemptId,
      publicKey,
    });
  }
  private bind(binding: Binding): void {
    if (this.disposed) return;
    this.stopLoop();
    this.binding = binding;
    try {
      if (!this.listening) {
        this.listening = this.appWindow();
        this.listening.addEventListener("message", this.receive);
      }
      this.startLoop("handshake", 250, true);
    } catch (e) {
      this.dispose();
      throw e;
    }
  }
  slowHandshake(): void {
    if (this.loop?.mode === "handshake") this.startLoop("handshake", 1000);
  }
  stopHandshake(): void {
    if (this.loop?.mode === "handshake") this.stopLoop();
  }
  startHeartbeat(): void {
    this.startLoop("heartbeat", 2000);
  }
  stopHeartbeat(): void {
    if (this.loop?.mode === "heartbeat") this.stopLoop();
  }
  ack(messageId: string, version: 1 | 2): void {
    if (!this.binding || this.disposed) return;
    this.post(this.binding, {
      type: "pubky-passport.authorization-outcome-ack",
      version,
      messageId,
      ...(version === 2 ? { attemptId: this.attemptId } : {}),
    });
  }
  unbind(): void {
    this.binding = undefined;
    this.stopLoop();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.binding = undefined;
    this.stopLoop();
    const listening = this.listening;
    this.listening = undefined;
    safely(() => listening?.removeEventListener("message", this.receive));
  }

  private readonly receive = (event: MessageEvent<unknown>): void => {
    const binding = this.binding;
    if (!binding || this.disposed) return;
    try {
      if (event.origin !== binding.origin) return this.ignored(event.data, "origin", binding);
      if (event.source !== binding.popup) return this.ignored(event.data, "source", binding);
      const data = event.data;
      const message = parsePassportMessage(data);
      if (!this.current(binding)) return;
      if (!message) return this.ignored(data, "schema", binding);
      if (message.version === 2 && message.attemptId !== this.attemptId)
        return this.ignored(data, "attempt", binding);
      if (message.type === "pubky-passport.ready") {
        safely(() =>
          this.observer.event({
            type: "READY",
            ...message.request,
            ...(message.features.includes(PROFILE_SETUP_FEATURE)
              ? { profileSetup: true as const }
              : {}),
          }),
        );
      } else if (message.type === "pubky-passport.profile-ready") {
        safely(() => this.observer.event({ type: "PROFILE_READY" }));
      } else if (message.type === "pubky-passport.status") {
        safely(() => this.observer.event({ type: "STATUS", phase: message.phase }));
      } else {
        const first = !this.outcomeReceived;
        this.outcomeReceived = true;
        if (message.version === 1) {
          safely(() =>
            this.observer.diagnostic?.({ code: "passport_protocol_v1", attemptId: this.attemptId }),
          );
          if (!this.current(binding)) return;
        }
        if (!first) return this.ack(message.messageId, message.version);
        safely(() =>
          this.observer.event({
            type: "OUTCOME",
            outcome: message.outcome,
            messageId: message.messageId,
            version: message.version,
            ...(message.code ? { code: message.code } : {}),
          }),
        );
      }
    } catch {
      /* Malformed native/synthetic event getters fail closed. */
    }
  };
  private ignored(
    data: unknown,
    reason: "origin" | "source" | "schema" | "attempt",
    binding: Binding,
  ): void {
    if (!isPassportMessage(data) || !this.current(binding)) return;
    safely(() =>
      this.observer.diagnostic?.({ code: "message_ignored", reason, attemptId: this.attemptId }),
    );
  }
  private current(binding: Binding): boolean {
    return !this.disposed && this.binding === binding;
  }
  private post(binding: Binding, message: unknown): void {
    if (this.current(binding) && binding.origin !== "*")
      safely(() => this.port.post(binding.popup, message, binding.origin));
  }
  private startLoop(mode: Loop["mode"], ms: number, immediate = false): void {
    this.stopLoop();
    const binding = this.binding;
    if (!binding || this.disposed) return;
    const loop: Loop = { mode, binding, ms, cancel: () => {} };
    this.loop = loop;
    try {
      if (immediate) this.hello(loop);
      this.schedule(loop);
    } catch (e) {
      if (this.loop === loop) this.stopLoop();
      throw e;
    }
  }
  private hello(loop: Loop): void {
    if (this.loop !== loop) return;
    this.post(loop.binding, {
      type: "pubky-passport.hello",
      version: 2,
      attemptId: this.attemptId,
      features: ["outcome-v2", "status"],
      profile: this.profile,
      network: this.network,
      ...loop.binding.match,
    });
  }
  private schedule(loop: Loop): void {
    if (this.loop !== loop || !this.current(loop.binding)) return;
    loop.cancel = this.clock.schedule(() => {
      if (this.loop !== loop) return;
      try {
        this.hello(loop);
        this.schedule(loop);
      } catch (e) {
        if (this.loop !== loop) return;
        this.stopLoop();
        safely(() => this.observer.failed?.(e));
      }
    }, loop.ms);
  }
  private stopLoop(): void {
    const loop = this.loop;
    this.loop = undefined;
    safely(() => loop?.cancel());
  }
}

function safely(operation: () => unknown): void {
  try {
    void Promise.resolve(operation()).catch(() => {});
  } catch {
    /* Observers and best-effort browser operations cannot interrupt ownership cleanup. */
  }
}
