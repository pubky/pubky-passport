import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import {
  readAndScrubAuthorizationEntry,
  type AuthorizationEntry,
} from "../entry/authorizationEntry";
import { takeInitialAuthorizationEntry } from "../../../../instrumentation-client";
import {
  type AuthorizationRequestReview,
  ValidatedPubkyAuthRequest,
} from "../request/ValidatedPubkyAuthRequest";
import { approveAuthorization } from "./approveAuthorization";
import {
  type AuthorizationOutcome,
  handoffAuthorizationOutcome,
} from "./authorizationOutcomeHandoff";

/** Finite, render-safe states emitted by the authorization controller. */
export type PassportAuthorizationViewState =
  | { status: "manual-entry" }
  | { status: "invalid" }
  | { status: "review"; review: AuthorizationRequestReview }
  | { status: "preparing"; review: AuthorizationRequestReview }
  | { status: "granting"; review: AuthorizationRequestReview }
  | { status: "completing"; review: AuthorizationRequestReview }
  | { status: "approved" }
  | { status: "cancelled" }
  | { status: "failed" };

type LocalTerminalState = Extract<
  PassportAuthorizationViewState,
  { status: "approved" | "cancelled" | "failed" }
>;

type AuthorizationAction = Readonly<{
  request: ValidatedPubkyAuthRequest;
  review: AuthorizationRequestReview;
}>;

let browserController: PassportAuthorizationController | undefined;

/** Coordinates one reviewed request from browser entry to a terminal outcome. */
export class PassportAuthorizationController {
  private abortController = new AbortController();
  private disposed = false;
  private listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  private request: ValidatedPubkyAuthRequest | undefined;
  private state: PassportAuthorizationViewState;

  /** Idempotently captures and owns the current authorization document. */
  static fromBrowser(): PassportAuthorizationController {
    if (browserController) return browserController;
    const appWindow = window;
    const entry = takeInitialAuthorizationEntry()
      ?? readAndScrubAuthorizationEntry(appWindow);
    browserController = new PassportAuthorizationController(appWindow, entry);
    return browserController;
  }

  constructor(
    private appWindow: Window,
    entry: AuthorizationEntry,
  ) {
    if (entry.status !== "valid") {
      this.state = { status: entry.status === "empty" ? "manual-entry" : "invalid" };
      return;
    }

    this.request = entry.request;
    this.state = { status: "review", review: entry.request.review };
  }

  getState(): PassportAuthorizationViewState {
    return this.state;
  }

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
    return this.completeRequestOutcome(
      action.request,
      Result.isOk(result) ? "success" : "error",
      review,
    );
  }

  async cancel(): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action) return this.state;

    return this.completeRequestOutcome(action.request, "cancel", action.review);
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
  ): Promise<PassportAuthorizationViewState> {
    if (this.disposed) {
      request.release();
      return this.state;
    }

    this.request = undefined;
    const callback = request.takeOutcomeCallback(outcome);
    if (!callback) return this.update(localStateForOutcome(outcome));

    this.update({ status: "completing", review });
    let handoffStatus: Awaited<ReturnType<typeof handoffAuthorizationOutcome>>;
    try {
      handoffStatus = await handoffAuthorizationOutcome(
        this.appWindow,
        callback,
        outcome,
        this.abortController.signal,
      );
    } catch {
      LOGGER.warn("authorize.callback.failed", {
        outcome,
        operation: "complete",
      });
      return this.update(localStateForOutcome(outcome));
    }
    if (handoffStatus !== "unavailable") return this.state;

    LOGGER.warn("authorize.callback.failed", {
      outcome,
      operation: "complete",
    });
    return this.update(localStateForOutcome(outcome));
  }

  private update(state: PassportAuthorizationViewState): PassportAuthorizationViewState {
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        LOGGER.warn("authorize.state_listener.failed", {
          state: state.status,
        });
      }
    }
    return state;
  }
}

function localStateForOutcome(outcome: AuthorizationOutcome): LocalTerminalState {
  switch (outcome) {
    case "success":
      return { status: "approved" };
    case "error":
      return { status: "failed" };
    case "cancel":
      return { status: "cancelled" };
  }
}

export type { AuthorizationRequestReview } from "../request/ValidatedPubkyAuthRequest";
