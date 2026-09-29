import "client-only";

import { Result } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { AuthorizationEntry } from "@/client/logic/authorization/entry/authorizationEntry";
import {
  type AuthorizationRequestReview,
  ValidatedPubkyAuthRequest,
} from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { relayAnswerAckUrl } from "@/client/logic/authorization/request/relayInbox";
import { watchForRingAnswer } from "@/client/logic/universal-signer/ringAnswerWatch";
import { approveAuthorization } from "./approveAuthorization";
import {
  type AuthorizationOutcome,
  canMessageOpener,
  handoffAuthorizationOutcome,
} from "./authorizationOutcomeHandoff";
import {
  approvalSeen,
  EXTERNAL_APPROVAL_WATCH_PACE,
  type ExternalApprovalObservation,
  type ExternalApprovalWatchOptions,
  lookAtAppChannel,
} from "./externalApprovalWatch";

/**
 * Why an approval failed: `identity` when Passport could not unlock the chosen identity's key in
 * this browser (another identity, or the key restored from a backup, may work), `delivery` when
 * the approval was not made or did not reach the app (only a new sign-in from the app can help).
 */
export type AuthorizationFailureReason = "identity" | "delivery";

/**
 * Finite, render-safe states emitted by the authorization controller. Every state of a supplied
 * request keeps its safe `review`, so outcome screens can name the app they answered.
 */
export type PassportAuthorizationViewState =
  | { status: "manual-entry" }
  /** The request's link could not be used: malformed, unsafe or in an unsupported form. */
  | { status: "invalid" }
  /** The request was captured but Passport's page took too long to load to take it. */
  | { status: "expired" }
  | { status: "review"; review: AuthorizationRequestReview }
  | { status: "preparing"; review: AuthorizationRequestReview }
  | { status: "granting"; review: AuthorizationRequestReview }
  /** The outcome is being handed back to the app; `outcome` says which one. */
  | { status: "completing"; review: AuthorizationRequestReview; outcome: AuthorizationOutcome }
  | { status: "approved"; review: AuthorizationRequestReview }
  /**
   * Handed to an external signer. `observed` says what Passport saw on the app's relay channel
   * when it ended the handoff by itself; without it the person reported the approval.
   */
  | {
      status: "handed-off";
      review: AuthorizationRequestReview;
      observed?: ExternalApprovalObservation | undefined;
    }
  | { status: "cancelled"; review: AuthorizationRequestReview }
  | { status: "failed"; review: AuthorizationRequestReview; reason: AuthorizationFailureReason };

type LocalTerminalState = Extract<
  PassportAuthorizationViewState,
  { status: "approved" | "handed-off" | "cancelled" | "failed" }
>;

type AuthorizationAction = Readonly<{
  request: ValidatedPubkyAuthRequest;
  review: AuthorizationRequestReview;
}>;

let browserController: PassportAuthorizationController | undefined;

/** Reads the bootstrap authorization entry captured by the page entrypoint. */
export type TakeInitialAuthorizationEntry = () => AuthorizationEntry | undefined;

/** Coordinates one reviewed request from browser entry to a terminal outcome. */
export class PassportAuthorizationController {
  private abortController = new AbortController();
  private disposed = false;
  private listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  private request: ValidatedPubkyAuthRequest | undefined;
  private state: PassportAuthorizationViewState;

  /**
   * Idempotently owns the injected bootstrap entry, consulting the taker once when the
   * page-scoped controller is first created. This method never reads or scrubs the
   * address bar itself; the Next.js client entrypoint does that before hydration, and
   * its taker may re-scrub a restored secret-bearing URL, so callers decide whether
   * invoking it during render is acceptable.
   */
  static fromBrowser(
    takeInitialAuthorizationEntry: TakeInitialAuthorizationEntry,
  ): PassportAuthorizationController {
    if (browserController) return browserController;
    const entry = takeInitialAuthorizationEntry() ?? { status: "empty" };
    browserController = new PassportAuthorizationController(window, entry);
    return browserController;
  }

  /**
   * @param appWindow Window used for callback handoff and lifecycle operations.
   * @param entry Scrubbed entry whose private request metadata becomes controller-owned.
   */
  constructor(
    private readonly appWindow: Window,
    entry: AuthorizationEntry,
  ) {
    if (entry.status !== "valid") {
      this.state = {
        status:
          entry.status === "empty"
            ? "manual-entry"
            : entry.status === "expired"
              ? "expired"
              : "invalid",
      };
      return;
    }

    this.request = entry.request;
    this.state = { status: "review", review: entry.request.review };
  }

  getState(): PassportAuthorizationViewState {
    return this.state;
  }

  /**
   * Returns the exact validated request for an intentional external-signer handoff.
   * Callers must not persist, log, or copy this value into general presentation state.
   */
  externalSignerUrl(): string | undefined {
    if (this.disposed || this.state.status !== "review") return undefined;
    return this.request?.validatedUrlForApproval();
  }

  /**
   * Subscribes to state transitions. Listener exceptions are contained so they
   * cannot interrupt an authorization flow.
   */
  subscribe(listener: (state: PassportAuthorizationViewState) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Releases an abandoned review and aborts approval until its irreversible SDK commit. */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.abortController.abort();
    this.request?.release();
    this.request = undefined;
    this.listeners.clear();
    if (browserController === this) browserController = undefined;
  }

  async approve(publicKeyZ32: string): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action) return this.state;

    const review = action.review;
    this.update({ status: "preparing", review });
    const result = await approveAuthorization(
      action.request,
      publicKeyZ32,
      this.abortController.signal,
      () => {
        if (!this.disposed) this.update({ status: "granting", review });
      },
    );
    if (Result.isOk(result)) return this.completeRequestOutcome(action.request, "success", review);
    return this.completeRequestOutcome(action.request, "error", review, {
      status: "failed",
      review,
      reason: result.error.code === "identity_unavailable" ? "identity" : "delivery",
    });
  }

  async cancel(): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action) return this.state;

    return this.completeRequestOutcome(action.request, "cancel", action.review);
  }

  /** Whether Passport can notice by itself that the app took an external signer's answer. */
  canWatchExternalApproval(): boolean {
    return this.externalApprovalAckUrl() !== undefined;
  }

  /**
   * While the request is handed to an external signer such as Pubky Ring, looks read-only at the
   * app's relay channel and ends the review as {@link finishExternalApproval} does once the answer
   * is there for the app. While the app's page can receive Passport's outcome message (a popup
   * with its opener), that is once the app has acknowledged Ring's answer; otherwise Passport can
   * only answer by navigating back to the app, where the app takes the answer, so an answer that
   * is posted and waits untouched counts too. The look never takes or acknowledges the message
   * (see `lookAtAppChannel`), pauses while the page is hidden and stops when the review ends.
   * Returns a function that stops watching; without a relay that offers such a look it does
   * nothing.
   */
  watchExternalApproval({ fetch, ...options }: ExternalApprovalWatchOptions = {}): () => void {
    const ackUrl = this.externalApprovalAckUrl();
    if (!ackUrl) return () => undefined;
    const fetchFn = fetch ?? ((url, init) => this.appWindow.fetch(url, init));
    let observed: ExternalApprovalObservation | undefined;
    const stopWatching = watchForRingAnswer(
      async (signal) => {
        const look = await lookAtAppChannel(ackUrl, fetchFn, signal);
        const seen = approvalSeen(look, canMessageOpener(this.appWindow));
        if (look === "taken" || look === "posted") observed = look;
        return seen;
      },
      () => {
        stop();
        void this.finishExternalApproval({ observed });
      },
      EXTERNAL_APPROVAL_WATCH_PACE,
      options,
    );
    const unsubscribe = this.subscribe((state) => {
      if (state.status !== "review") stop();
    });
    function stop(): void {
      stopWatching();
      unsubscribe();
    }
    return stop;
  }

  /**
   * Ends the review after the person reports approving the request in an external signer such as
   * Pubky Ring, or after {@link watchExternalApproval} saw the answer on the app's channel
   * (`observed`). Passport cannot verify that approval, so the `success` outcome it hands back is
   * a hint like every outcome: the app still finishes its own SDK flow.
   * Without a usable callback the request ends as `handed-off`, never as approved.
   */
  async finishExternalApproval({
    observed,
  }: {
    observed?: ExternalApprovalObservation | undefined;
  } = {}): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action) return this.state;

    return this.completeRequestOutcome(action.request, "success", action.review, {
      status: "handed-off",
      review: action.review,
      ...(observed ? { observed } : {}),
    });
  }

  private externalApprovalAckUrl(): string | undefined {
    const url = this.externalSignerUrl();
    return url === undefined ? undefined : relayAnswerAckUrl(url);
  }

  private beginAction(): AuthorizationAction | undefined {
    if (this.disposed || !this.request || this.state.status !== "review") return undefined;

    return {
      request: this.request,
      review: this.state.review,
    };
  }

  private async completeRequestOutcome(
    request: ValidatedPubkyAuthRequest,
    outcome: AuthorizationOutcome,
    review: AuthorizationRequestReview,
    localState: LocalTerminalState = localStateForOutcome(outcome, review),
  ): Promise<PassportAuthorizationViewState> {
    if (this.disposed) {
      request.release();
      return this.state;
    }

    this.request = undefined;
    const callback = request.takeOutcomeCallback(outcome);
    if (!callback) return this.update(localState);

    this.update({ status: "completing", review, outcome });
    let handoffStatus: Awaited<ReturnType<typeof handoffAuthorizationOutcome>>;
    try {
      handoffStatus = await handoffAuthorizationOutcome(
        this.appWindow,
        callback,
        outcome,
        this.abortController.signal,
      );
    } catch (e) {
      LOGGER.warn("authorize.callback.failed", {
        outcome,
        operation: "complete",
        ...safeErrorLogFields(e),
      });
      return this.update(localState);
    }
    if (handoffStatus !== "unavailable") return this.state;

    LOGGER.warn("authorize.callback.failed", {
      outcome,
      operation: "complete",
    });
    return this.update(localState);
  }

  private update(state: PassportAuthorizationViewState): PassportAuthorizationViewState {
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (e) {
        LOGGER.warn("authorize.state_listener.failed", {
          state: state.status,
          ...safeErrorLogFields(e),
        });
      }
    }
    return state;
  }
}

function localStateForOutcome(
  outcome: AuthorizationOutcome,
  review: AuthorizationRequestReview,
): LocalTerminalState {
  switch (outcome) {
    case "success":
      return { status: "approved", review };
    case "error":
      return { status: "failed", review, reason: "delivery" };
    case "cancel":
      return { status: "cancelled", review };
  }
}
