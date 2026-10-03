import type { Session } from "@synonymdev/pubky";
import { AttemptController } from "../attempt/AttemptController.js";
import { AttemptEffects, type RedirectCommand } from "../attempt/AttemptEffects.js";
import {
  isLiveState,
  type AttemptContext,
  type PassportState,
  type SessionInfo,
} from "../attempt/attemptModel.js";
import type { PubkyFacade } from "../config/PassportClientOptions.js";
import {
  resolveBrowserOptions,
  type ResolvedClientOptions,
} from "../config/resolveClientOptions.js";
import { browserEnvironment } from "../environment/browserEnvironment.js";
import {
  PassportError,
  type PassportAction,
  type PassportErrorOptions,
} from "../errors/PassportError.js";
import { formatMessage } from "../errors/formatMessage.js";
import { clientFingerprint } from "../flow/clientFingerprint.js";
import type { FlowPort } from "../flow/FlowPort.js";
import { FlowRegistry } from "../flow/FlowRegistry.js";
import type { FlowOptions } from "../flow/pubkyFlowAdapter.js";
import { RedirectNavigation } from "../flow/RedirectNavigation.js";
import { RedirectStateStore } from "../flow/RedirectStateStore.js";
import { returnCallbacks, returnPage } from "../flow/returnCallbacks.js";
import { takeRedirectReturn } from "../flow/takeRedirectReturn.js";
import { InstanceResolver } from "../instance/InstanceResolver.js";
import type { InstanceChangeResult, PassportInstance } from "../instance/PassportInstance.js";
import { BrowserPopup } from "../popup/BrowserPopup.js";
import { openPassportPopup } from "../popup/openPassportPopup.js";
import { parseReturnMarker, type ParsedReturnMarker } from "../protocol/parseReturnMarker.js";
import { scrubReturnUrl } from "../protocol/scrubReturnUrl.js";
import { createAttemptId } from "../shared/attemptId.js";
import type { Clock } from "../shared/Clock.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import { createSessionReceiver } from "./createSessionReceiver.js";
import type { ProfileRead } from "../profile/PassportProfile.js";
import type { AttemptResult } from "./AttemptResult.js";
import type { PreparedLease, ReturnResult } from "./InternalClient.js";
import { PopupActions } from "./PopupActions.js";

/** Browser and SDK seams; tests replace them, production uses the page and the SDK. */
export interface ClientPlatform {
  available(): boolean;
  window(): Window;
  clock: Clock;
  flowPort(options: FlowOptions, errors: Omit<PassportErrorOptions, "cause" | "detail">): FlowPort;
  readProfile(publicKey: string, pubky?: PubkyFacade): Promise<ProfileRead>;
  validateCapabilities(input: string): string;
}
export interface RuntimeObserver {
  state(state: PassportState): void;
  session(session: Session, info: SessionInfo): void;
  diagnostic(value: PassportDiagnostic): void;
}
interface SavedFlow {
  readonly instance: PassportInstance;
  readonly state: string;
}

const LEASE_IDLE_MS = 1000;

/** One browser page's wiring of the attempt machine; built at the client's first browser call. */
export class ClientRuntime {
  readonly controller: AttemptController;
  readonly defaultInstance: PassportInstance;
  readonly appName: string;
  private readonly page: Window;
  private readonly options: ReturnType<typeof resolveBrowserOptions>;
  private readonly errors: {
    messages?: NonNullable<ResolvedClientOptions["messages"]>;
    context: { appName: string; defaultHost: string };
  };
  private readonly resolver: InstanceResolver;
  private readonly flows: FlowRegistry;
  private readonly popup: BrowserPopup;
  private readonly store: RedirectStateStore;
  private readonly actions: PopupActions;
  private readonly navigation: RedirectNavigation;
  private readonly cleanups: (() => void)[] = [];
  private nextAttempt: string | undefined;
  private leases = 0;
  private leaseIdle: (() => void) | undefined;
  private resume: SavedFlow | undefined;
  private disposed = false;

  constructor(
    resolved: ResolvedClientOptions,
    private readonly platform: ClientPlatform,
    private readonly observer: RuntimeObserver,
  ) {
    const page = platform.window();
    this.page = page;
    const options = resolveBrowserOptions(resolved, page.location);
    this.options = options;
    this.appName = options.appName;
    const clock = platform.clock;
    const emit = (value: PassportDiagnostic) => observer.diagnostic(value);
    this.defaultInstance = Object.freeze({
      origin: options.instance,
      host: new URL(options.instance).host,
      isCustom: false,
    });
    this.errors = {
      ...(options.messages ? { messages: options.messages } : {}),
      context: { appName: options.appName, defaultHost: this.defaultInstance.host },
    };
    this.resolver = new InstanceResolver(
      { ...options, onDiagnostic: emit },
      () => page.localStorage,
      () => ({ appName: options.appName }),
    );
    const flowOptions: FlowOptions = {
      appName: options.appName,
      clientId: options.clientId,
      capabilities: options.capabilities,
      ...(options.pubky ? { pubky: options.pubky } : {}),
    };
    // A same-tab sign-in comes back to this page, as it was when the client started.
    const returnTo = returnPage(page.location);
    const port = (instance: PassportInstance) =>
      platform.flowPort(flowOptions, { ...this.errors, instance });
    const popup = new BrowserPopup(() => page, options.development?.openWindow, clock);
    this.popup = popup;
    this.flows = new FlowRegistry(
      port,
      {
        event: (event) => this.controller.dispatch(event),
        session: (flowId, session) => receive(flowId, session),
        diagnostic: emit,
      },
      clock,
      this.errors,
    );
    this.store = new RedirectStateStore({
      storage: () => page.sessionStorage,
      client: clientFingerprint(options),
      defaultOrigin: options.instance,
      clock,
    });
    const effects = new AttemptEffects({
      flows: this.flows,
      popup,
      profile: options.profile,
      readProfile: (publicKey) => platform.readProfile(publicKey, options.pubky),
      event: (event) => this.controller.dispatch(event),
      diagnostic: emit,
      failed: (cause) => this.fail(cause),
      redirect: (command) => this.redirect(command),
      returnCallbacks: (attemptId) => returnCallbacks(returnTo, attemptId),
      appWindow: () => page,
      clock,
    });
    this.controller = new AttemptController(
      this.resolver.getInstance(),
      () => this.context(),
      effects,
      emit,
      clock,
    );
    const receive = createSessionReceiver(this.controller, {
      capabilities: options.capabilities,
      normalize: platform.validateCapabilities,
      adapter: port,
    });
    this.actions = new PopupActions({
      controller: this.controller,
      popup,
      flows: this.flows,
      defaultInstance: this.defaultInstance,
      instance: () => this.resolver.getInstance(),
      nextAttemptId: () => (this.nextAttempt = this.attemptId()),
      environment: () => browserEnvironment(page),
      diagnostic: emit,
      errors: this.errors,
    });
    this.navigation = new RedirectNavigation({
      controller: this.controller,
      flows: this.flows,
      store: this.store,
      page: () => page,
      profile: options.profile,
      errors: this.errors,
    });
    this.controller.subscribe((state) => observer.state(state));
    this.controller.onSession((session, info) => observer.session(session, info));
    // TAB-08: once, at the first browser call; a return marker leaves classification to handleReturn.
    const discarded = this.store.sweep(this.marker() !== undefined);
    if (discarded) emit(discarded);
    this.listen(page, "pagehide", (event) =>
      this.controller.dispatch({
        type: "PAGE_HIDE",
        persisted: (event as PageTransitionEvent).persisted === true,
      }),
    );
    this.listen(page, "pageshow", (event) => {
      if ((event as PageTransitionEvent).persisted === true)
        this.controller.dispatch({ type: "PAGE_RESTORED" });
    });
    this.listen(page.document, "visibilitychange", () =>
      this.controller.dispatch({ type: this.visible() ? "DOCUMENT_VISIBLE" : "DOCUMENT_HIDDEN" }),
    );
    // Window focus only rechecks a missing profile; it never focuses a Passport popup.
    this.listen(page, "focus", () => {
      if (this.controller.getState().status === "needs-profile")
        this.controller.dispatch({ type: "FOCUS" });
    });
  }

  signIn(): Promise<AttemptResult> {
    const state = this.controller.getState();
    // Signing in again while a profile is missing means finishing it in Passport.
    if (state.status === "needs-profile") {
      const pending = this.controller.reserveResult();
      if (state.passport === "open") this.actions.focus();
      else this.openProfile(state);
      return pending;
    }
    return this.actions.signIn();
  }

  perform(action: PassportAction): void {
    const state = this.controller.getState();
    switch (action) {
      case "sign-in":
      case "retry":
        void this.actions.signIn();
        return;
      case "focus":
        return this.actions.focus();
      case "reopen":
        return this.actions.reopen();
      case "cancel":
        return this.controller.cancel();
      case "use-default-instance":
        return this.actions.useDefaultInstance();
      case "reset-instance":
        return this.resetInstance();
      case "create-profile":
        return this.openProfile(state);
    }
  }

  prepare(): PreparedLease {
    this.leases++;
    this.leaseIdle?.();
    this.leaseIdle = undefined;
    this.controller.dispatch({ type: "PREPARE" });
    let held = true;
    return Object.freeze({
      release: () => {
        if (!held) return;
        held = false;
        this.leases--;
        if (this.leases > 0 || this.disposed) return;
        this.leaseIdle = this.platform.clock.schedule(() => {
          this.leaseIdle = undefined;
          this.controller.dispatch({ type: "LEASE_IDLE" });
        }, LEASE_IDLE_MS);
      },
      ringOpened: () => {
        if (held) this.controller.dispatch({ type: "RING_OPENED" });
      },
    });
  }

  /** Consumes a same-tab return to this page; `stray` when it belongs to another tab. */
  handleReturn(): ReturnResult {
    const controller = this.controller;
    if (controller.getState().status !== "idle" || !controller.quiescent()) return "none";
    let url: URL;
    try {
      url = new URL(this.page.location.href);
    } catch {
      return "none";
    }
    const taken = takeRedirectReturn(this.store, this.marker(url), () =>
      scrubReturnUrl(url, this.page.history),
    );
    if (taken.kind !== "resume") {
      if (taken.diagnostic) this.observer.diagnostic(taken.diagnostic);
      if (taken.kind !== "invalid") return taken.kind;
      controller.dispatch({ type: "RETURN_DETECTED", valid: false });
      return "none";
    }
    this.resume = { instance: taken.instance, state: taken.record.state };
    controller.dispatch({
      type: "RETURN_DETECTED",
      valid: true,
      marker: taken.marker,
      instance: taken.instance,
      attemptId: taken.record.attemptId,
    });
    // ResumeFlow ran synchronously inside that transition; never retain saved state.
    this.resume = undefined;
    return "none";
  }

  /** The large element's expired code: a fresh Ring request in its place. */
  reloadRing(): void {
    this.controller.dispatch({ type: "RING_RELOAD" });
  }

  getInstance(): PassportInstance {
    return this.resolver.getInstance();
  }

  setInstance(input: string): InstanceChangeResult {
    const state = this.controller.getState();
    if (isLiveState(state))
      return {
        ok: false,
        code: "attempt_in_progress",
        message: formatMessage("instance.attempt_in_progress", this.options.messages, {
          ...this.errors.context,
          instanceHost: state.instance.host,
        }),
      };
    const result = this.resolver.setInstance(input);
    if (result.ok) this.controller.dispatch({ type: "SELECT_INSTANCE", instance: result.instance });
    return result;
  }

  resetInstance(): void {
    if (isLiveState(this.controller.getState())) return;
    this.resolver.resetInstance();
    this.controller.dispatch({ type: "SELECT_INSTANCE", instance: this.resolver.getInstance() });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.leaseIdle?.();
    this.leaseIdle = undefined;
    this.resume = undefined;
    for (const cleanup of this.cleanups.splice(0)) attempt(cleanup);
    this.controller.dispose();
  }

  private context(): AttemptContext {
    const state = this.controller?.getState();
    // PopupActions reserves the next attempt's id; later transitions get fresh ids (A15).
    if (state && "attemptId" in state && state.attemptId === this.nextAttempt)
      this.nextAttempt = undefined;
    return {
      defaultInstance: this.defaultInstance,
      attemptId: this.nextAttempt ?? this.attemptId(),
      now: this.platform.clock.now(),
      leases: this.leases,
      visible: this.visible(),
      profile: this.options.profile,
      timeouts: this.options.timeouts,
      ...(this.options.messages ? { messages: this.options.messages } : {}),
      appName: this.options.appName,
    };
  }

  private redirect(command: RedirectCommand): void {
    switch (command.type) {
      case "SaveStateAndNavigate":
        return this.navigation.navigate(command.flowId);
      case "DeleteRedirectState":
        return this.store.deleteOwned();
      case "ResumeFlow": {
        const record = this.resume;
        this.resume = undefined;
        if (record) this.flows.resume(command.flowId, record.instance, record.state);
        else this.controller.dispatch({ type: "RESUME_FAILED", flowId: command.flowId });
        return;
      }
    }
  }

  /**
   * Reopens Passport on the held Session's profile setup, in a window this attempt watches and
   * binds (its hello names the key), so Passport can answer `profile-ready`.
   */
  private openProfile(state: PassportState): void {
    if (state.status !== "needs-profile" || state.passport || !this.controller.quiescent()) return;
    const opened = openPassportPopup(
      this.popup,
      {
        instance: state.instance,
        attemptId: state.attemptId,
        generation: 0,
        profileKey: state.publicKey,
      },
      browserEnvironment(this.page).userActivation,
    );
    if (opened.diagnostic) this.observer.diagnostic(opened.diagnostic);
    if (opened.kind !== "live") return;
    this.controller.dispatch({ type: "PROFILE_WINDOW", popup: opened.popup });
    // A window the attempt did not adopt (it moved on meanwhile) is not left behind.
    if (this.controller.snapshot().popup !== opened.popup)
      attempt(() => this.popup.close(opened.popup));
  }

  private fail(cause: unknown): void {
    const state = this.controller.getState();
    this.controller.dispatch({
      type: "RUNTIME_FAILED",
      error: new PassportError("internal", { ...this.errors, instance: state.instance, cause }),
      ...("attemptId" in state ? { attemptId: state.attemptId } : {}),
    });
  }

  private marker(url?: URL): ParsedReturnMarker | undefined {
    try {
      return parseReturnMarker(
        (url ?? new URL(this.page.location.href)).searchParams.get("pubky-passport"),
      );
    } catch {
      return undefined;
    }
  }

  private attemptId(): string {
    return createAttemptId(this.page.crypto ?? globalThis.crypto);
  }

  private visible(): boolean {
    try {
      return this.page.document.visibilityState !== "hidden";
    } catch {
      return true;
    }
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    const listener = (event: Event) => attempt(() => handler(event));
    attempt(() => {
      target.addEventListener(type, listener);
      this.cleanups.push(() => target.removeEventListener(type, listener));
    });
  }
}

function attempt(operation: () => void): void {
  try {
    operation();
  } catch {
    /* Browser listeners and cleanup never throw into the app. */
  }
}
