import type { PassportTimeouts } from "../config/PassportClientOptions.js";
import type { PassportError } from "../errors/PassportError.js";
import type { PassportMessageOverrides } from "../errors/messageTypes.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import type { PassportProfile } from "../profile/PassportProfile.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import type { RingLink } from "../shared/RingLink.js";
import type { BlockedPopupRoute, RedirectCause, SignInRoute } from "./chooseSignInRoute.js";

export type SignInVia = "popup" | "ring" | "redirect";
export type PassportPhase = "ring" | "granting";
interface AttemptBase {
  attemptId: string;
  instance: PassportInstance;
}
export type PassportState =
  | { status: "idle"; instance: PassportInstance; lastError?: PassportError }
  | { status: "preparing"; instance: PassportInstance; lastError?: PassportError }
  | {
      status: "ready";
      instance: PassportInstance;
      ringLink: RingLink;
      lastError?: PassportError;
      /** The code reached its lifetime but cannot be replaced yet (Ring opened, page hidden). */
      expired?: true;
    }
  // ringLink is present exactly when the active flow is polling.
  | (AttemptBase & { status: "opening"; ringLink?: RingLink })
  | (AttemptBase & {
      status: "waiting";
      ringLink: RingLink;
      handshake: "confirmed" | "unconfirmed";
      phase?: PassportPhase;
      window: "open" | "closed";
    })
  | (AttemptBase & {
      status: "detached";
      ringLink: RingLink;
      reason: "unreachable" | "request-lost";
    })
  | (AttemptBase & { status: "redirecting" })
  | (AttemptBase & { status: "finishing"; via: SignInVia })
  | (AttemptBase & {
      status: "needs-profile";
      publicKey: string;
      check: "missing" | "error";
      /** Passport's window is open on this profile's setup (after `profile-needed`). */
      passport?: "open";
    })
  | (AttemptBase & { status: "signed-in"; publicKey: string })
  | (AttemptBase & { status: "failed"; error: PassportError });

export interface FlowRecord {
  readonly instance: PassportInstance;
  readonly attemptId: string;
  /** A "redirect" flow carries callbacks back to this page; the others are polled here. */
  readonly via: SignInVia;
  readonly status: "creating" | "created" | "polling" | "draining" | "freeing";
  readonly exposed: boolean;
  readonly endedBy?: "passive" | "app" | "abandoned";
  readonly ringLink?: RingLink;
}

/** SDK flows live in the registry; this model keeps ids, metadata, RingLinks and the popup. */
export interface AttemptModel {
  readonly state: PassportState;
  readonly selection: PassportInstance;
  readonly flows: ReadonlyMap<number, FlowRecord>;
  readonly lastFlowId: number;
  /** All flows allocated before the most recent Session delivery are superseded. */
  readonly supersededThrough: number;
  /** The active flow's ledger id. */
  readonly flow?: number;
  readonly popup?: Window;
  readonly generation: number;
  readonly navigatedAt?: number;
  readonly disposed: boolean;
  readonly ringPinned: boolean;
  readonly rotateDue: boolean;
  readonly capDue: boolean;
  readonly prepareFailures: number;
  readonly hiddenCapped: boolean;
  readonly redirectCause?: RedirectCause;
  readonly redirectQr?: number;
  readonly returnMarker?: ReturnMarker;
  readonly heldSession?: { readonly sessionId: number; readonly info: HeldSessionInfo };
  readonly profileChecking?: true;
  /** The bound Passport advertised `profile-setup`: it can create a missing profile. */
  readonly profileSetup?: true;
  /** `profile-needed` went to Passport for the held Session. */
  readonly profileAsked?: true;
  /** Quick rechecks left after `profile-ready`, for a homeserver that lags behind. */
  readonly fastRechecks?: number;
}

export function createAttemptModel(instance: PassportInstance): AttemptModel {
  return Object.freeze({
    state: Object.freeze({ status: "idle" as const, instance }),
    selection: instance,
    flows: new Map<number, FlowRecord>(),
    lastFlowId: 0,
    supersededThrough: 0,
    generation: 0,
    disposed: false,
    ringPinned: false,
    rotateDue: false,
    capDue: false,
    prepareFailures: 0,
    hiddenCapped: false,
  });
}

export interface AttemptContext {
  readonly defaultInstance: PassportInstance;
  readonly attemptId: string;
  readonly now: number;
  readonly leases: number;
  readonly visible: boolean;
  readonly profile: "required" | "optional";
  readonly timeouts: PassportTimeouts;
  readonly messages?: PassportMessageOverrides;
  readonly appName?: string;
}

export type AttemptTimer =
  | "ATTEMPT"
  | "HANDSHAKE_HINT"
  | "CLOSED_GRACE"
  | "DETACHED"
  | "FINISHING"
  | "PROFILE_RECHECK"
  | "PREPARE_RETRY"
  | "RING_ROTATE"
  | "RING_PIN_ELAPSED"
  | "HIDDEN_CAP"
  | "LEASE_IDLE";
export type AttemptEvent =
  | { type: "PROFILE_FOUND"; sessionId: number; profile: PassportProfile }
  | { type: "PROFILE_MISSING" | "PROFILE_CHECK_FAILED"; sessionId: number }
  | { type: "RUNTIME_FAILED"; error: PassportError; flowId?: number; attemptId?: string }
  | {
      type: "SESSION_RECEIVED";
      flowId: number;
      sessionId: number;
      error: PassportError;
    }
  | {
      type: "SESSION_RECEIVED";
      flowId: number;
      sessionId: number;
      publicKey: string;
      capabilities: readonly string[];
      capabilitiesMatch: boolean;
    }
  | { type: "SIGN_IN"; popup: Window | undefined; instance: PassportInstance }
  | { type: "SELECT_INSTANCE"; instance: PassportInstance }
  | {
      type: "SIGN_IN";
      instance: PassportInstance;
      route: Exclude<SignInRoute, { kind: "popup" }> | BlockedPopupRoute;
    }
  | {
      type: "RETURN_DETECTED";
      valid: true;
      marker: ReturnMarker;
      instance: PassportInstance;
      attemptId: string;
    }
  | { type: "RETURN_DETECTED"; valid: false }
  | { type: "RESUMED" | "RESUME_FAILED"; flowId: number }
  | { type: "FLOW_CREATED"; flowId: number; ringLink: RingLink }
  | { type: "FLOW_FAILED" | "POLL_FAILED"; flowId: number; error: PassportError }
  | {
      type: "READY";
      status: "valid" | "invalid" | "empty" | "expired" | "completed";
      code?: string;
      profileSetup?: true;
    }
  /** Passport says it published the profile; the window reopened for profile setup. */
  | { type: "PROFILE_READY" }
  | { type: "PROFILE_WINDOW"; popup: Window }
  | { type: "REOPEN" | "USE_DEFAULT_INSTANCE"; popup: Window }
  | { type: "STATUS"; phase: PassportPhase }
  | {
      type: "OUTCOME";
      outcome: "success" | "cancel" | "error";
      messageId: string;
      version: 1 | 2;
      code?: string;
    }
  | { type: "PAGE_HIDE"; persisted: boolean }
  | {
      type:
        | "HANDSHAKE_HINT"
        | "POPUP_CLOSED"
        | "CLOSED_GRACE"
        | "DETACHED_TIMEOUT"
        | "FINISHING_TIMEOUT"
        | "ATTEMPT_TIMEOUT"
        | "FOCUS"
        | "PROFILE_RECHECK"
        | "CANCEL"
        | "RESET"
        | "DISPOSE"
        | "PREPARE"
        | "PREPARE_RETRY"
        | "RING_ROTATE"
        | "RING_OPENED"
        | "RING_RELOAD"
        | "RING_PIN_ELAPSED"
        | "HIDDEN_CAP"
        | "LEASE_IDLE"
        | "DOCUMENT_VISIBLE"
        | "DOCUMENT_HIDDEN"
        | "REDIRECT_SAVE_FAILED"
        | "PAGE_RESTORED";
    };
export type AttemptEffect =
  | { type: "CheckProfile"; sessionId: number; publicKey: string }
  /** `returnTo` is the attempt a same-tab flow's callbacks bring back to this page. */
  | { type: "CreateFlow"; flowId: number; instance: PassportInstance; returnTo?: string }
  | { type: "StartPolling" | "FreeFlow"; flowId: number }
  | { type: "RetireFlow"; flowId: number; ms: number }
  | { type: "NavigatePopup"; popup: Window; flowId: number; origin: string }
  | { type: "WatchPopup" | "ClosePopup" | "FocusPopup"; popup: Window }
  | { type: "StartHandshake"; popup: Window; origin: string; attemptId: string; flowId: number }
  /** Binds Passport's profile setup page, which names the key instead of a request. */
  | {
      type: "StartProfileHandshake";
      popup: Window;
      origin: string;
      attemptId: string;
      publicKey: string;
    }
  | { type: "ProfileNeeded"; publicKey: string }
  | { type: "StopHandshake" | "StartHeartbeat" | "StopHeartbeat" | "SlowHandshake" }
  | { type: "SetTimer"; timer: AttemptTimer; ms: number }
  | { type: "ClearTimer"; timers: readonly AttemptTimer[] }
  | { type: "Ack"; messageId: string; version: 1 | 2 }
  | {
      type: "Diagnostic";
      code: PassportDiagnostic["code"];
      unattributed?: true;
    }
  | { type: "EndAttempt"; error?: PassportError; by: "passive" | "app" }
  | { type: "SaveStateAndNavigate" | "ResumeFlow"; flowId: number }
  | { type: "DeleteRedirectState" }
  | { type: "RevokeSession"; sessionId: number }
  | { type: "EmitSession"; sessionId: number; info: SessionInfo };
export interface SessionInfo {
  readonly publicKey: string;
  /** The validated `pubky.app` profile, or null when there is none (or it could not be read). */
  readonly profile: PassportProfile | null;
  /** The origin of the Passport this attempt opened, which produced the Session. */
  readonly instance: string;
}
export type HeldSessionInfo = Omit<SessionInfo, "profile" | "instance">;
export type ReturnMarker = "s" | "c" | "e" | "none";
export interface AttemptTransition {
  readonly model: AttemptModel;
  readonly effects: readonly AttemptEffect[];
}

const POPUP_STATES = [
  "opening",
  "waiting",
  "detached",
] as const satisfies readonly PassportState["status"][];
const IDLE_LIKE = [
  "idle",
  "failed",
  "signed-in",
] as const satisfies readonly PassportState["status"][];
const LIVE = [
  ...POPUP_STATES,
  "redirecting",
  "finishing",
  "needs-profile",
] as const satisfies readonly PassportState["status"][];

export function isPopupState(state: PassportState): boolean {
  return POPUP_STATES.some((status) => status === state.status);
}
export function isIdleLike(state: PassportState): boolean {
  return IDLE_LIKE.some((status) => status === state.status);
}
export function isLiveState(state: PassportState): boolean {
  return LIVE.some((status) => status === state.status);
}
