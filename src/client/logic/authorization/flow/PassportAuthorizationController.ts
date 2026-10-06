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
import { type AuthorizationOutcome, canMessageOpener } from "./authorizationOutcomeHandoff";
import { handoffOpenerOutcome } from "./openerOutcomeHandoff";
import type { ApprovalFailureReason } from "./approvalFailureReason";
import type { EditProfileEntry } from "../entry/editProfileEntry";
import { takeOpenerChannel, type OpenerChannel } from "../opener/OpenerChannel";
import { requireProfileAfterGoogleRedirect } from "@/client/logic/google-identity/gia/googleRedirectBootstrap";
import { hasLiveOpener } from "./hasLiveOpener";
import { navigateExternalReturn } from "./navigateExternalReturn";
import {
  approvalSeen,
  EXTERNAL_APPROVAL_WATCH_PACE,
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
  /**
   * The request's link could not be used: malformed, unsafe or in an unsupported form, or, with
   * `reason`, made for another Pubky network than this instance's.
   */
  | { status: "invalid"; reason?: "network_mismatch" }
  /** The request was captured but Passport's page took too long to load to take it. */
  | { status: "expired" }
  | {
      status: "review";
      review: AuthorizationRequestReview;
      /**
       * The app asked for an identity with a pubky.app profile, next to `d=` or in its bound
       * hello. A signal for Passport's own steps, never a credential or part of the request.
       */
      profileRequired?: true;
    }
  | { status: "preparing"; review: AuthorizationRequestReview }
  | { status: "granting"; review: AuthorizationRequestReview }
  /** The outcome is being handed back to the app; `outcome` says which one. */
  | { status: "completing"; review: AuthorizationRequestReview; outcome: AuthorizationOutcome }
  | { status: "approved"; review: AuthorizationRequestReview }
  /**
   * Handed to an external signer whose answer Passport saw reach the app's relay channel, with no
   * app page left to hand back to: Passport's own home follows. Never a claim of a sign-in.
   */
  | { status: "handed-off"; review: AuthorizationRequestReview }
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
/** Reads the `/#profile=<key>` entry captured by the page entrypoint. */
export type TakeInitialProfileEntry = () => string | undefined;
/** Reads the `/#edit-profile=<key>` entry captured by the page entrypoint. */
export type TakeInitialEditProfileEntry = () => EditProfileEntry | undefined;

/** Coordinates one reviewed request from browser entry to a terminal outcome. */
export class PassportAuthorizationController {
  private abortController = new AbortController();
  private disposed = false;
  private listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  private request: ValidatedPubkyAuthRequest | undefined;
  private state: PassportAuthorizationViewState;
  private ringViewOpen = false;
  /** The key whose profile the app waits for: its `profile-needed`, or the profile page's key. */
  private appProfileKey: string | undefined;
  /** `/#edit-profile=<key>`: an app linked to that identity's profile editor. */
  private readonly editEntry: EditProfileEntry | undefined;
  private readonly unsubscribeOpener: (() => void) | undefined;

  /**
   * Idempotently owns the injected bootstrap entry, consulting the taker once when the
   * page-scoped controller is first created. This method never reads or scrubs the
   * address bar itself; the Next.js client entrypoint does that before hydration, and
   * its taker may re-scrub a restored secret-bearing URL, so callers decide whether
   * invoking it during render is acceptable.
   */
  static fromBrowser(
    takeInitialAuthorizationEntry: TakeInitialAuthorizationEntry,
    takeInitialProfileEntry: TakeInitialProfileEntry = () => undefined,
    takeInitialEditProfileEntry: TakeInitialEditProfileEntry = () => undefined,
  ): PassportAuthorizationController {
    if (browserController) return browserController;
    const entry = takeInitialAuthorizationEntry() ?? { status: "empty" };
    browserController = new PassportAuthorizationController(
      window,
      entry,
      takeOpenerChannel(),
      entry.status === "valid" ? undefined : takeInitialProfileEntry(),
      entry.status === "valid" ? undefined : takeInitialEditProfileEntry(),
    );
    return browserController;
  }

  /**
   * @param appWindow Window used for callback handoff and lifecycle operations.
   * @param entry Scrubbed entry whose private request metadata becomes controller-owned.
   */
  constructor(
    private readonly appWindow: Window,
    entry: AuthorizationEntry,
    private readonly openerChannel?: OpenerChannel,
    profileEntryKey?: string,
    editProfileEntry?: EditProfileEntry,
  ) {
    if (entry.status !== "valid") {
      // `/#profile=<key>`: an app reopened Passport to finish this identity's profile.
      if (entry.status === "empty") this.appProfileKey = profileEntryKey;
      // `/#edit-profile=<key>`: a page without a request, so nothing here can approve one.
      if (entry.status === "empty" && profileEntryKey === undefined)
        this.editEntry = editProfileEntry;
      this.state =
        entry.status === "invalid" && entry.code === "network_mismatch"
          ? { status: "invalid", reason: "network_mismatch" }
          : {
              status:
                entry.status === "empty"
                  ? "manual-entry"
                  : entry.status === "expired"
                    ? "expired"
                    : "invalid",
            };
      return;
    }

    // The app's hello, read before this page hydrated, may already name another network.
    if (openerChannel?.networkMismatch()) {
      entry.request.release();
      this.state = { status: "invalid", reason: "network_mismatch" };
      return;
    }
    this.request = entry.request;
    this.state = {
      status: "review",
      review: entry.request.review,
      ...(entry.profile === "required" || openerChannel?.verifiedOpener()?.profile === "required"
        ? { profileRequired: true as const }
        : {}),
    };
    // A hello's requirement is not in the request itself: a Google round trip must keep it.
    if (this.state.profileRequired) requireProfileAfterGoogleRedirect(entry.request);
    this.unsubscribeOpener = openerChannel?.subscribe(() => {
      if (openerChannel.networkMismatch()) return this.refuseForeignNetwork();
      if (this.ringViewOpen) this.reportPhase("ring");
      // A hello that binds after the page loaded can still ask for a profile before the review.
      if (
        this.state.status === "review" &&
        !this.state.profileRequired &&
        openerChannel.verifiedOpener()?.profile === "required"
      ) {
        requireProfileAfterGoogleRedirect(entry.request);
        this.update({ ...this.state, profileRequired: true });
      }
      this.takeProfileRequest(openerChannel);
    });
  }

  getState(): PassportAuthorizationViewState {
    return this.state;
  }

  /**
   * The app's hello, bound after the review appeared, names another Pubky network: the request
   * leaves the screen before anything can approve it. The channel already told the app.
   */
  private refuseForeignNetwork(): void {
    if (this.state.status !== "review" || this.disposed) return;
    this.leaveExternalSigner();
    this.request?.release();
    this.request = undefined;
    this.update({ status: "invalid", reason: "network_mismatch" });
  }

  /**
   * After a Pubky Ring sign-in the app may ask for the profile of the key Ring approved: taken
   * only while the request is with Ring (its screen open, or its answer seen), never over a
   * review or an approval in this window; a message at any other time is dropped. Taking it
   * retires the request, as the Ring report does: Ring has answered the app, and nothing here
   * approves anything anymore.
   */
  private takeProfileRequest(openerChannel: OpenerChannel): void {
    const needed = openerChannel.profileRequest();
    if (needed === undefined || this.appProfileKey !== undefined) return;
    if (!this.ringViewOpen && this.state.status !== "handed-off")
      return openerChannel.forgetProfileRequest();
    this.appProfileKey = needed;
    if (this.state.status === "review") {
      const review = this.state.review;
      this.leaveExternalSigner();
      this.request?.release();
      this.request = undefined;
      openerChannel.updateRequestState({ status: "completed" });
      this.update({ status: "handed-off", review });
    } else this.update({ ...this.state });
  }

  /**
   * The key whose profile the app waits for: after this request went to Pubky Ring, the one its
   * bound app named in `profile-needed`; on `/#profile=<key>`, that key. A prompt only.
   */
  profileNeeded(): string | undefined {
    return this.disposed ? undefined : this.appProfileKey;
  }

  /**
   * The edit link this page opened on: the key whose profile editor it opens, or `invalid` for a
   * link in another shape. A prompt only: what may be edited is decided by the keys this browser
   * holds and by Pubky Ring, never by the link.
   */
  editProfileEntry(): EditProfileEntry | undefined {
    return this.disposed ? undefined : this.editEntry;
  }

  /**
   * Tells the app that opened the edit link (only its origin, and only after its hello named the
   * key) that the profile is published. False when no app is bound to hear it, as with a plain link.
   */
  profileUpdated(): boolean {
    if (this.disposed || this.editEntry?.status !== "edit") return false;
    const posted = this.openerChannel?.postProfileUpdated();
    return posted !== undefined && Result.isOk(posted);
  }

  /** Tells the bound app the profile is published; false when no app is bound to hear it. */
  profileReady(): boolean {
    const posted = this.openerChannel?.postProfileReady();
    return posted !== undefined && Result.isOk(posted);
  }

  /**
   * Returns the exact validated request for an intentional external-signer handoff.
   * Callers must not persist, log, or copy this value into general presentation state.
   */
  externalSignerUrl(): string | undefined {
    if (this.disposed || this.state.status !== "review") return undefined;
    return this.request?.validatedUrlForApproval();
  }

  /** Explicit Ring intent (including a late binding), or the approval's irreversible commit. */
  reportPhase(phase: "ring" | "granting"): void {
    if (this.disposed || !this.request) return;
    if (
      (phase === "ring" && this.state.status === "review") ||
      (phase === "granting" && this.state.status === "granting")
    ) {
      if (phase === "ring") this.ringViewOpen = true;
      this.openerChannel?.post({ type: "pubky-passport.status", phase });
    }
  }

  /** Leaving the Ring screen prevents a later first hello from reporting stale intent. */
  leaveExternalSigner(): void {
    this.ringViewOpen = false;
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
    this.unsubscribeOpener?.();
    this.leaveExternalSigner();
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
    this.leaveExternalSigner();
    this.update({ status: "preparing", review });
    const result = await approveAuthorization(
      action.request,
      publicKeyZ32,
      this.abortController.signal,
      () => {
        if (!this.disposed) {
          this.update({ status: "granting", review });
          this.reportPhase("granting");
        }
      },
    );
    if (Result.isOk(result)) return this.completeRequestOutcome(action.request, "success", review);
    return this.completeRequestOutcome(
      action.request,
      "error",
      review,
      {
        status: "failed",
        review,
        reason:
          result.error.code === "identity_unavailable" ||
          result.error.code === "storage_unavailable"
            ? "identity"
            : "delivery",
      },
      result.error.code !== "cancelled" ? result.error.code : undefined,
    );
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
   * app's relay channel and ends the handoff ({@link endExternalHandoff}) once the answer is there
   * for the app. Nobody reports an approval by hand: without such a look, or until it sees the
   * answer, the request stays with the signer (an app with a verified opener closes this window
   * once its own SDK has the Session). While the app's page can receive Passport's outcome message (a popup
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
    const stopWatching = watchForRingAnswer(
      async (signal) =>
        approvalSeen(
          await lookAtAppChannel(ackUrl, fetchFn, signal),
          canMessageOpener(this.appWindow),
        ),
      () => {
        stop();
        void this.endExternalHandoff();
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
   * Ends the review once {@link watchExternalApproval} saw an external signer's answer on the
   * app's channel. Passport cannot verify that approval, so the `success` outcome it hands back is
   * a hint like every outcome: the app still finishes its own SDK flow.
   * Without an opener or callback to hand back to, the request ends as `handed-off` (Passport's
   * home), never as approved.
   * A v2 (hello-verified) opener instead gets `status{ring}` and a `completed` request, never a
   * `success` outcome: its app keeps waiting for its SDK Session (A26). Without a live opener the
   * request returns to its validated callback by navigation.
   */
  private async endExternalHandoff(): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action) return this.state;

    const handedOff = { status: "handed-off" as const, review: action.review };
    // Without a v2 hello the v1 hand-off applies unchanged: an opener message, else the callback.
    if (!this.openerChannel?.verifiedOpener())
      return this.completeRequestOutcome(action.request, "success", action.review, handedOff);

    this.reportPhase("ring");
    this.leaveExternalSigner();
    this.request = undefined;
    this.openerChannel?.updateRequestState({ status: "completed" });
    const callback = action.request.takeOutcomeCallback("success");
    // PS-8: a bound opener that has gone can only be answered by returning to the callback.
    if (!hasLiveOpener(this.appWindow) && callback) {
      this.update({ status: "completing", review: action.review, outcome: "success" });
      if (this.disposed) return this.state;
      if (navigateExternalReturn(this.appWindow, callback) === "navigated") return this.state;
    }
    return this.update(handedOff);
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
    reason?: ApprovalFailureReason,
  ): Promise<PassportAuthorizationViewState> {
    if (this.disposed) {
      request.release();
      return this.state;
    }

    this.leaveExternalSigner();
    this.request = undefined;
    this.openerChannel?.updateRequestState({ status: "completed" });
    const callback = request.takeOutcomeCallback(outcome);
    if (!callback && !this.openerChannel?.verifiedOpener()) return this.update(localState);

    this.update({ status: "completing", review, outcome });
    let handoffStatus: Awaited<ReturnType<typeof handoffOpenerOutcome>>;
    try {
      handoffStatus = await handoffOpenerOutcome(
        this.appWindow,
        callback,
        outcome,
        this.abortController.signal,
        this.openerChannel,
        reason,
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

    if (callback) {
      LOGGER.warn("authorize.callback.failed", {
        outcome,
        operation: "complete",
      });
    }
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
