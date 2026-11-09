import type { Session } from "@synonymdev/pubky";
import type { PassportState, SessionInfo } from "../attempt/attemptModel.js";
import {
  PUBLIC_OPTIONS,
  type InternalClientOptions,
  type PassportClientOptions,
} from "../config/PassportClientOptions.js";
import { PassportConfigError } from "../config/PassportConfigError.js";
import {
  resolveClientOptions,
  type ResolvedClientOptions,
} from "../config/resolveClientOptions.js";
import {
  PassportError,
  type PassportAction,
  type PassportErrorCode,
} from "../errors/PassportError.js";
import { formatMessage } from "../errors/formatMessage.js";
import type { MessageContext } from "../errors/messageTypes.js";
import { createPubkyFlowAdapter, validateCapabilities } from "../flow/pubkyFlowAdapter.js";
import type { InstanceChangeResult, PassportInstance } from "../instance/PassportInstance.js";
import { readProfile } from "../profile/readProfile.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import { systemClock } from "../shared/Clock.js";
import { describePassportState, type ButtonView } from "../view/describeState.js";
import type { AttemptResult } from "./AttemptResult.js";
import { ClientRuntime, type ClientPlatform } from "./ClientRuntime.js";
import type { InternalClient, PreparedLease, ReturnResult, Unsubscribe } from "./InternalClient.js";
import { readKeychainAuth } from "../config/keychainAuth.js";
import type {
  PassportClient,
  PassportEntry,
  PassportView,
  SignedIn,
  SignInOptions,
  SignInResult,
} from "./PassportClient.js";

const BROWSER: ClientPlatform = {
  available: () => typeof window !== "undefined" && typeof document !== "undefined",
  window: () => window,
  clock: systemClock,
  flowPort: createPubkyFlowAdapter,
  readProfile,
  validateCapabilities,
};
const INERT_LEASE: PreparedLease = Object.freeze({ release() {}, ringOpened() {} });

/**
 * The headless API. Every option is optional; a bad option throws PassportConfigError, nothing
 * else throws. The first client on a page also finishes a same-tab sign-in that returns to it.
 */
export function createPassportClient(options?: PassportClientOptions): PassportClient {
  return publicClient(createClient(publicOptions(options), BROWSER));
}

/** Internal: the element's test seam and the e2e fixtures, which may set internal options. */
export function createInternalClient(options?: InternalClientOptions): InternalClient {
  return createClient(options, BROWSER);
}

/** Internal seam for tests; production code uses createPassportClient. */
export function createClient(
  options: InternalClientOptions | undefined,
  platform: ClientPlatform,
): InternalClient {
  const client = new Client(resolveClientOptions(options, platform.validateCapabilities), platform);
  // A same-tab return is consumed by the first client created on the page, before any sign-in;
  // apps never call handleReturn() for it. On a server nothing is touched.
  if (platform.available()) client.handleReturn();
  return client;
}

/** Only the public options reach a public client; an unknown key is a configuration error. */
function publicOptions(
  options: PassportClientOptions | undefined,
): PassportClientOptions | undefined {
  if (options === null || typeof options !== "object" || Array.isArray(options)) return options;
  const unknown = Object.keys(options).filter(
    (key) => !(PUBLIC_OPTIONS as readonly string[]).includes(key),
  );
  if (unknown.length)
    throw new PassportConfigError(
      unknown.map((option) => ({ option, code: "unknown_option", message: "Unknown option." })),
    );
  return options;
}

/** The five public methods over an internal client; nothing else is reachable from it. */
export function publicClient(client: InternalClient): PassportClient {
  let signedIn: SignedIn | undefined;
  let queued = false;
  const listeners = new Set<(view: PassportView) => void>();
  const describe = (): PassportView => {
    const { label, status, tone, busy } = client.describe();
    const { origin, isCustom } = client.getInstance();
    return Object.freeze({
      label: signedIn ? "" : label,
      ...(status !== undefined && !signedIn ? { status } : {}),
      tone: signedIn ? "success" : tone,
      busy: signedIn ? false : busy,
      ...(signedIn ? { signedIn } : {}),
      instance: Object.freeze({ origin, isCustom }),
      classicQr: client.classicQr(),
    });
  };
  // Coalesced, so the state change and the Session that follows it arrive as one view.
  const changed = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const view = describe();
      for (const listener of [...listeners]) notify(() => listener(view));
    });
  };
  client.subscribe((state) => {
    if (state.status !== "signed-in") signedIn = undefined;
    changed();
  });
  client.onSession((session, info) => {
    signedIn = toSignedIn(session, info);
    changed();
  });
  return Object.freeze({
    signIn(options?: SignInOptions) {
      // Synchronous up to the window opening, as the click requires.
      const entry = options?.entry;
      return client
        .signIn(entry === "join" || entry === "google" || entry === "sign-in" ? entry : undefined)
        .then(toPublicResult);
    },
    setClassicQr(on: boolean) {
      client.setClassicQr(on === true);
      changed();
    },
    describe,
    subscribe(listener: (view: PassportView) => void) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      client.cancel();
      client.reset();
    },
    dispose() {
      listeners.clear();
      client.dispose();
    },
  });
}

function toSignedIn(session: Session, info: SessionInfo): SignedIn {
  return Object.freeze({
    session,
    publicKey: info.publicKey,
    profile: info.profile,
    instance: info.instance,
  });
}

function toPublicResult(result: AttemptResult): SignInResult {
  return result.status === "signed-in"
    ? Object.freeze({ status: "signed-in", ...toSignedIn(result.session, result.info) })
    : result;
}

class Client implements InternalClient {
  #runtime: ClientRuntime | undefined;
  #disposed = false;
  #state: PassportState;
  #instance: PassportInstance;
  #returned: ReturnResult | undefined;
  readonly #states = new Set<(state: PassportState) => void>();
  readonly #sessions = new Set<(session: Session, info: SessionInfo) => void>();
  readonly #defaultHost: string;

  constructor(
    private readonly options: ResolvedClientOptions,
    private readonly platform: ClientPlatform,
  ) {
    // SSR-safe: nothing here touches a browser global.
    this.#defaultHost = new URL(options.instance).host;
    this.#instance = Object.freeze({
      origin: options.instance,
      host: this.#defaultHost,
      isCustom: false,
    });
    this.#state = Object.freeze({ status: "idle", instance: this.#instance });
  }

  messageContext(): Partial<MessageContext> {
    const appName = this.#runtime?.appName ?? this.options.appName;
    return { defaultHost: this.#defaultHost, ...(appName !== undefined ? { appName } : {}) };
  }

  signIn(entry?: PassportEntry): Promise<AttemptResult> {
    const runtime = this.#ensure();
    if (!runtime)
      return Promise.resolve({
        status: "failed",
        error: this.#error(this.#disposed ? "internal" : "unsupported_environment"),
      });
    return runtime.signIn(entry);
  }

  setEntry(entry: PassportEntry | undefined): void {
    this.#ensure()?.setEntry(entry);
  }

  setClassicQr(on: boolean): void {
    this.#ensure()?.setClassicQr(on);
  }

  classicQr(): boolean {
    // Read without starting the runtime: describing the client must not set it up.
    if (this.#runtime) return this.#runtime.classicQr();
    if (this.#disposed || !this.platform.available()) return false;
    return readKeychainAuth(() => this.platform.window().localStorage) === "cookie";
  }

  perform(action: PassportAction): void {
    this.#ensure()?.perform(action);
  }

  prepare(): PreparedLease {
    return this.#ensure()?.prepare() ?? INERT_LEASE;
  }

  cancel(): void {
    this.#runtime?.controller.cancel();
  }

  handleReturn(): ReturnResult {
    if (this.#returned) return this.#returned;
    const runtime = this.#ensure();
    if (!runtime) return "none";
    return (this.#returned = runtime.handleReturn());
  }

  reloadRing(): void {
    this.#runtime?.reloadRing();
  }

  reset(): void {
    this.#runtime?.controller.reset();
  }

  getState(): PassportState {
    return this.#runtime?.controller.getState() ?? this.#state;
  }

  subscribe(listener: (state: PassportState) => void): Unsubscribe {
    return this.#add(this.#states, listener);
  }

  onSession(listener: (session: Session, info: SessionInfo) => void): Unsubscribe {
    return this.#add(this.#sessions, listener);
  }

  describe(state?: PassportState): ButtonView {
    return describePassportState(
      state ?? this.getState(),
      this.options.messages,
      this.messageContext(),
    );
  }

  getInstance(): PassportInstance {
    const runtime = this.#ensure();
    if (runtime) this.#instance = runtime.getInstance();
    return this.#instance;
  }

  setInstance(input: string): InstanceChangeResult {
    const runtime = this.#ensure();
    if (!runtime)
      return {
        ok: false,
        code: "internal",
        message: formatMessage("error.internal", this.options.messages, {
          defaultHost: this.#defaultHost,
          instanceHost: this.#instance.host,
        }),
      };
    const result = runtime.setInstance(input);
    if (result.ok) this.#instance = result.instance;
    return result;
  }

  resetInstance(): void {
    const runtime = this.#ensure();
    if (!runtime) return;
    runtime.resetInstance();
    this.#instance = runtime.getInstance();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#runtime?.dispose();
    this.#states.clear();
    this.#sessions.clear();
  }

  #ensure(): ClientRuntime | undefined {
    if (this.#disposed) return undefined;
    if (this.#runtime) return this.#runtime;
    if (!this.platform.available()) return undefined;
    try {
      this.#runtime = new ClientRuntime(this.options, this.platform, {
        state: (state) => this.#publish(state),
        session: (session, info) => this.#deliver(session, info),
        diagnostic: (value) => this.#emit(value),
      });
    } catch (e) {
      if (e instanceof PassportConfigError) throw e;
      return undefined;
    }
    this.#instance = this.#runtime.getInstance();
    const initial = this.#runtime.controller.getState();
    // A stored custom instance changes the pre-browser idle view; an equal one is not news.
    if (!sameInstance(initial.instance, this.#state.instance)) this.#publish(initial);
    else this.#state = initial;
    return this.#runtime;
  }

  #publish(state: PassportState): void {
    if (state === this.#state) return;
    this.#state = state;
    for (const listener of [...this.#states]) notify(() => listener(state));
  }

  #deliver(session: Session, info: SessionInfo): void {
    for (const listener of [...this.#sessions]) notify(() => listener(session, info));
  }

  #emit(value: PassportDiagnostic): void {
    const frozen = Object.freeze({ ...value });
    notify(() => this.options.onDiagnostic?.(frozen));
  }

  #add<T>(set: Set<T>, listener: T): Unsubscribe {
    if (this.#disposed || typeof listener !== "function") return () => {};
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  #error(code: PassportErrorCode): PassportError {
    return new PassportError(code, {
      instance: this.#instance,
      ...(this.options.messages ? { messages: this.options.messages } : {}),
      context: {
        defaultHost: this.#defaultHost,
        ...(this.options.appName !== undefined ? { appName: this.options.appName } : {}),
      },
    });
  }
}

function sameInstance(a: PassportInstance, b: PassportInstance): boolean {
  return a.origin === b.origin && a.isCustom === b.isCustom;
}

function notify(call: () => unknown): void {
  try {
    void Promise.resolve(call()).catch(() => {});
  } catch {
    /* Observers cannot reject sign-in or interrupt another observer. */
  }
}
