import { AuthFlowKind, type GrantAuthFlowOptions, type Session } from "@synonymdev/pubky";

import { PassportConfigError, resolveConfig } from "./config.js";
import {
  ACK_MESSAGE_TYPE,
  authorizeUrl,
  MESSAGE_VERSION,
  readOutcomeMessage,
  readReturnMessage,
  returnUrl,
  type PassportOutcome,
} from "./protocol.js";

export { PassportConfigError } from "./config.js";
export type { PassportOutcome } from "./protocol.js";

/** How often a closed popup is checked for. Two checks in a row confirm it. */
export const POPUP_CHECK_INTERVAL_MS = 500;
const POPUP_CLOSED_CONFIRMATIONS = 2;
/** Pause between relay polls. */
export const POLL_INTERVAL_MS = 250;
/**
 * After `success` the popup closes and the Session should follow within seconds. A forged or lost
 * `success` must not keep the attempt pending until the deadline.
 */
export const SUCCESS_GRACE_MS = 30_000;
/** Network or relay errors in a row that a poll retries (with backoff) before ending as `failed`. */
export const MAX_POLL_RETRIES = 3;
const POPUP_NAME_PREFIX = "pubky-passport-";

export type PassportFailureReason =
  /** `window.open` returned nothing; ask the person to click again. Nothing was started. */
  | "popup-blocked"
  /** The person cancelled in Passport. */
  | "cancelled"
  /** Passport reported that it could not approve the request. */
  | "rejected"
  /** The popup was closed before an approval reached the relay. */
  | "popup-closed"
  /** No approval before `timeoutMs`. */
  | "timeout"
  /** The `signal`, `cancel()` or `dispose()` ended the attempt. */
  | "aborted"
  /** The Pubky SDK or the relay failed; see `error`. */
  | "failed";

export type PassportSignInResult =
  { ok: true; session: Session } | { ok: false; reason: PassportFailureReason; error?: unknown };

export type PassportAuthState = "idle" | "pending";

/** The SDK methods this package calls; pass your app's `Pubky` instance. */
export interface PassportPubky {
  startGrantAuthFlow(
    capabilities: string,
    kind: AuthFlowKind,
    options: GrantAuthFlowOptions,
  ): Promise<PassportGrantFlow>;
}

/** The part of the SDK's `GrantAuthFlow` this package uses. */
export interface PassportGrantFlow {
  readonly authorizationUrl: string;
  tryPollOnce(): Promise<Session | undefined>;
  free(): void;
}

export interface PassportAuthOptions {
  /** Your app's Pubky SDK instance (`new Pubky()`). */
  pubky: PassportPubky;
  /** Capabilities to request, e.g. `/pub/example.app/:rw`. Any `e` action asks for signed approval. */
  capabilities: string;
  /** Your app's identifier, typically its domain. */
  clientId: string;
  /** Name Passport shows for your app (`x-source`), at most 128 characters. */
  appName: string;
  /** Passport origin. Default `https://passport.pubky.app`. */
  instance?: string | undefined;
  /** Callback page on this page's origin, HTTPS only. Without it Passport shows its own result screen. */
  callbackUrl?: string | undefined;
  /** Deadline for one attempt. Default 5 minutes. */
  timeoutMs?: number | undefined;
}

export interface PassportSignInOptions {
  /** Aborting it ends the attempt with `aborted`. */
  signal?: AbortSignal | undefined;
}

export interface PassportAuth {
  readonly state: PassportAuthState;
  /**
   * Opens Passport and resolves when the attempt ends. Call it straight from a click handler.
   * While an attempt is pending it focuses the popup and returns that attempt's promise.
   * Never rejects.
   */
  signIn(options?: PassportSignInOptions): Promise<PassportSignInResult>;
  /** Called on every state change. Returns an unsubscribe function. */
  subscribe(listener: (state: PassportAuthState) => void): () => void;
  /** Ends a pending attempt with `aborted`. */
  cancel(): void;
  /** Ends a pending attempt and refuses new ones. */
  dispose(): void;
}

interface Attempt {
  readonly id: string;
  readonly popup: Window;
  readonly promise: Promise<PassportSignInResult>;
  readonly resolve: (result: PassportSignInResult) => void;
  ended: boolean;
  flow: PassportGrantFlow | undefined;
  freed: boolean;
  /** An SDK call (`startGrantAuthFlow` or `tryPollOnce`) has not settled yet. */
  sdkCallPending: boolean;
  /** Passport reported `success`: it closes the popup itself, so closing is no reason to stop. */
  successReported: boolean;
  closedChecks: number;
  /** Closed checks since `success`; past {@link SUCCESS_GRACE_MS} the hint no longer counts. */
  closedChecksAfterSuccess: number;
  /** Transient poll failures in a row. */
  pollFailures: number;
  /** Popup closed without an outcome: `pending` until the last poll starts, then `polling`. */
  lastPoll: "none" | "pending" | "polling";
  cleanups: (() => void)[];
  pollTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Creates a headless Passport sign-in. Throws `PassportConfigError` for invalid options. */
export function createPassportAuth(options: PassportAuthOptions): PassportAuth {
  if (typeof window === "undefined" || typeof window.open !== "function")
    throw new Error("@pubky/passport-auth: createPassportAuth runs in the browser only.");
  if (typeof options !== "object" || options === null || !isPubky(options.pubky))
    throw new PassportConfigError("pubky", "Pass your app's Pubky SDK instance (new Pubky()).");
  const config = resolveConfig(options, window.location.href);
  const pubky = options.pubky;
  const pageOrigin = window.location.origin;
  const listeners = new Set<(state: PassportAuthState) => void>();
  let current: Attempt | undefined;
  let disposed = false;

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        // Read the state per listener: an earlier listener may have started or ended an attempt.
        listener(current ? "pending" : "idle");
      } catch (error) {
        // A failing subscriber must not stop the cleanup; report it without swallowing it.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  };

  const freeFlow = (attempt: Attempt) => {
    // A flow must not be freed while one of its calls is in flight; the call frees it on return.
    if (!attempt.flow || attempt.freed || attempt.sdkCallPending) return;
    attempt.freed = true;
    try {
      attempt.flow.free();
    } catch {
      // Already released by the SDK.
    }
  };

  const end = (attempt: Attempt, result: PassportSignInResult) => {
    if (attempt.ended) return;
    attempt.ended = true;
    if (attempt.pollTimer !== undefined) clearTimeout(attempt.pollTimer);
    for (const cleanup of attempt.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // Keep releasing the rest.
      }
    }
    closePopup(attempt.popup);
    freeFlow(attempt);
    if (current === attempt) current = undefined;
    attempt.resolve(result);
    notify();
  };

  const handleOutcome = (attempt: Attempt, outcome: PassportOutcome) => {
    switch (outcome) {
      case "success":
        // The approval reached the relay. Only the Session from the SDK signs the person in.
        attempt.successReported = true;
        return;
      case "cancel":
        end(attempt, { ok: false, reason: "cancelled" });
        return;
      case "error":
        end(attempt, { ok: false, reason: "rejected" });
        return;
    }
  };

  const onMessage = (attempt: Attempt, event: MessageEvent<unknown>) => {
    if (attempt.ended || event.source !== attempt.popup) return;
    const message =
      event.origin === config.instanceOrigin ? readOutcomeMessage(event.data) : undefined;
    if (message) {
      try {
        attempt.popup.postMessage(
          { type: ACK_MESSAGE_TYPE, version: MESSAGE_VERSION, messageId: message.messageId },
          config.instanceOrigin,
        );
      } catch {
        // Passport falls back to the callback page, which reports the same outcome.
      }
      handleOutcome(attempt, message.outcome);
      return;
    }
    if (event.origin === pageOrigin) {
      const outcome = readReturnMessage(event.data, attempt.id);
      if (outcome) handleOutcome(attempt, outcome);
    }
  };

  const poll = (attempt: Attempt) => {
    attempt.pollTimer = undefined;
    const flow = attempt.flow;
    if (attempt.ended || !flow) return;
    if (attempt.lastPoll === "pending") attempt.lastPoll = "polling";
    const lastPoll = attempt.lastPoll === "polling";
    attempt.sdkCallPending = true;
    let call: Promise<Session | undefined>;
    try {
      call = flow.tryPollOnce();
    } catch (error) {
      call = Promise.reject(error);
    }
    call.then(
      (session) => {
        attempt.sdkCallPending = false;
        if (attempt.ended) {
          freeFlow(attempt);
          if (session) releaseSession(session);
          return;
        }
        attempt.pollFailures = 0;
        if (session) {
          end(attempt, { ok: true, session });
          return;
        }
        if (lastPoll) {
          if (!attempt.successReported) {
            end(attempt, { ok: false, reason: "popup-closed" });
            return;
          }
          // `success` arrived during the last poll: Passport closed the popup, keep waiting.
          attempt.lastPoll = "none";
        }
        // The popup closed while this poll ran: poll once more right away.
        if (attempt.lastPoll === "pending") poll(attempt);
        else attempt.pollTimer = setTimeout(() => poll(attempt), POLL_INTERVAL_MS);
      },
      (error: unknown) => {
        attempt.sdkCallPending = false;
        if (attempt.ended) {
          freeFlow(attempt);
          return;
        }
        if (isTransient(error) && attempt.pollFailures < MAX_POLL_RETRIES) {
          // A relay or network blip must not close the popup while the person is reviewing.
          attempt.pollFailures += 1;
          attempt.pollTimer = setTimeout(
            () => poll(attempt),
            POLL_INTERVAL_MS * 2 ** (attempt.pollFailures + 1),
          );
          return;
        }
        end(attempt, { ok: false, reason: "failed", error });
      },
    );
  };

  const onPopupCheck = (attempt: Attempt) => {
    if (attempt.ended || attempt.lastPoll !== "none") return;
    if (!isClosed(attempt.popup)) {
      attempt.closedChecks = 0;
      attempt.closedChecksAfterSuccess = 0;
      return;
    }
    if (attempt.successReported) {
      attempt.closedChecksAfterSuccess += 1;
      if (attempt.closedChecksAfterSuccess * POPUP_CHECK_INTERVAL_MS < SUCCESS_GRACE_MS) return;
      // The hint did not lead to a Session: treat the popup as closed without an outcome.
      attempt.successReported = false;
    }
    attempt.closedChecks += 1;
    if (attempt.closedChecks < POPUP_CLOSED_CONFIRMATIONS) return;
    // Passport never saw the request while the flow was still being created.
    if (!attempt.flow) {
      end(attempt, { ok: false, reason: "popup-closed" });
      return;
    }
    // The approval may already be on the relay: poll once more before giving up.
    attempt.lastPoll = "pending";
    if (attempt.sdkCallPending) return;
    if (attempt.pollTimer !== undefined) clearTimeout(attempt.pollTimer);
    poll(attempt);
  };

  const start = (attempt: Attempt) => {
    const callbacks = config.callbackUrl;
    const flowOptions: GrantAuthFlowOptions = {
      clientId: config.clientId,
      xCallback: callbacks
        ? {
            xSource: config.appName,
            xSuccess: returnUrl(callbacks, attempt.id, "success"),
            xError: returnUrl(callbacks, attempt.id, "error"),
            xCancel: returnUrl(callbacks, attempt.id, "cancel"),
          }
        : { xSource: config.appName },
      ...(config.signedApproval ? { approvalFormat: "signedApprovalV1" as const } : {}),
    };
    attempt.sdkCallPending = true;
    let call: Promise<PassportGrantFlow>;
    try {
      call = pubky.startGrantAuthFlow(config.capabilities, AuthFlowKind.signin(), flowOptions);
    } catch (error) {
      call = Promise.reject(error);
    }
    call.then(
      (flow) => {
        attempt.sdkCallPending = false;
        attempt.flow = flow;
        if (attempt.ended) {
          freeFlow(attempt);
          return;
        }
        try {
          // Built once and never logged: the URL carries the relay secret or the HPKE key.
          attempt.popup.location.replace(
            authorizeUrl(config.instanceOrigin, flow.authorizationUrl),
          );
        } catch (error) {
          end(attempt, { ok: false, reason: "failed", error });
          return;
        }
        poll(attempt);
      },
      (error: unknown) => {
        attempt.sdkCallPending = false;
        if (!attempt.ended) end(attempt, { ok: false, reason: "failed", error });
      },
    );
  };

  const signIn = (signInOptions: PassportSignInOptions = {}): Promise<PassportSignInResult> => {
    if (current) {
      focusPopup(current.popup);
      return current.promise;
    }
    const signal = signInOptions.signal;
    if (disposed || signal?.aborted)
      return Promise.resolve({
        ok: false,
        reason: "aborted",
        ...(signal?.aborted ? { error: signal.reason } : {}),
      });

    const id = randomId();
    // Opened before any await so the click still counts as a user gesture. No noopener:
    // Passport needs window.opener to hand the outcome back. The name is unique but unrelated
    // to the attempt id, which pages loaded in the popup can read through window.name.
    const popup = openPopup(`${POPUP_NAME_PREFIX}${randomId()}`);
    if (!popup) return Promise.resolve({ ok: false, reason: "popup-blocked" });

    let resolve!: (result: PassportSignInResult) => void;
    const promise = new Promise<PassportSignInResult>((settle) => {
      resolve = settle;
    });
    const attempt: Attempt = {
      id,
      popup,
      promise,
      resolve,
      ended: false,
      flow: undefined,
      freed: false,
      sdkCallPending: false,
      successReported: false,
      closedChecks: 0,
      closedChecksAfterSuccess: 0,
      pollFailures: 0,
      lastPoll: "none",
      cleanups: [],
      pollTimer: undefined,
    };
    current = attempt;
    try {
      watch(attempt, signal);
      notify();
      // A subscriber may have ended the attempt already.
      if (!attempt.ended) start(attempt);
    } catch (error) {
      end(attempt, { ok: false, reason: "failed", error });
    }
    return promise;
  };

  const watch = (attempt: Attempt, signal: AbortSignal | undefined) => {
    const messageListener = (event: MessageEvent<unknown>) => onMessage(attempt, event);
    window.addEventListener("message", messageListener);
    attempt.cleanups.push(() => window.removeEventListener("message", messageListener));
    const deadline = setTimeout(
      () => end(attempt, { ok: false, reason: "timeout" }),
      config.timeoutMs,
    );
    attempt.cleanups.push(() => clearTimeout(deadline));
    const popupCheck = setInterval(() => onPopupCheck(attempt), POPUP_CHECK_INTERVAL_MS);
    attempt.cleanups.push(() => clearInterval(popupCheck));
    if (signal) {
      const onAbort = () => end(attempt, { ok: false, reason: "aborted", error: signal.reason });
      signal.addEventListener("abort", onAbort, { once: true });
      attempt.cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
  };

  return {
    get state(): PassportAuthState {
      return current ? "pending" : "idle";
    },
    signIn,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      if (current) end(current, { ok: false, reason: "aborted" });
    },
    dispose() {
      disposed = true;
      if (current) end(current, { ok: false, reason: "aborted" });
      listeners.clear();
    },
  };
}

function isPubky(value: unknown): value is PassportPubky {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<PassportPubky>).startGrantAuthFlow === "function"
  );
}

function openPopup(name: string): Window | undefined {
  try {
    const popup = window.open("about:blank", name, "popup");
    if (!popup || isClosed(popup)) return undefined;
    return popup;
  } catch {
    return undefined;
  }
}

function isClosed(popup: Window): boolean {
  try {
    return popup.closed;
  } catch {
    return true;
  }
}

function focusPopup(popup: Window): void {
  try {
    popup.focus();
  } catch {
    // Best effort.
  }
}

function closePopup(popup: Window): void {
  try {
    if (!popup.closed) popup.close();
  } catch {
    // Closing a cross-origin popup is best effort.
  }
}

/** A Session that arrived after its attempt ended has no owner: revoke it and drop the handle. */
function releaseSession(session: Session): void {
  const free = () => {
    try {
      session.free();
    } catch {
      // Already released.
    }
  };
  try {
    void session.signout().then(free, free);
  } catch {
    free();
  }
}

/** Network or relay failures worth another poll; anything else ends the attempt. */
function isTransient(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, data } = error as {
    name?: unknown;
    data?: { reason?: unknown; statusCode?: unknown };
  };
  if (name !== "RequestError") return false;
  const reason = data?.reason;
  if (reason === "Timeout" || reason === "Connection") return true;
  const status = data?.statusCode;
  return reason === "Http" && typeof status === "number" && (status >= 500 || status === 429);
}

/** UUID where available; `randomUUID` needs a secure context, `getRandomValues` does not. */
function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
