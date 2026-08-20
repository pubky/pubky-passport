import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import {
  expireAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  type AuthorizationEntry,
} from "../entry/authorizationEntry";
import { takeInitialAuthorizationEntry } from "../entry/authorizationEntryBootstrap";
import {
  type AuthorizationRequestReview,
  IssuedPubkyAuthRequest,
} from "../request/IssuedPubkyAuthRequest";
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
  | { status: "approving"; review: AuthorizationRequestReview }
  | { status: "completing"; review: AuthorizationRequestReview }
  | { status: "approved" }
  | { status: "cancelled" }
  | { status: "failed" };

type LocalTerminalState = Extract<
  PassportAuthorizationViewState,
  { status: "approved" | "cancelled" | "failed" }
>;

type AuthorizationAction = Readonly<{
  request: IssuedPubkyAuthRequest;
  expiresAt: number;
  review: AuthorizationRequestReview;
}>;

/** Coordinates one reviewed request from browser entry to a terminal outcome. */
export class PassportAuthorizationController {
  private abortController = new AbortController();
  private disposed = false;
  private expirationTimer: number | undefined;
  private expiresAt: number | undefined;
  private listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  private request: IssuedPubkyAuthRequest | undefined;
  private state: PassportAuthorizationViewState;

  constructor(
    private appWindow: Window = window,
    entry: AuthorizationEntry = readAuthorizationEntry(appWindow),
  ) {
    if (entry.status !== "valid") {
      this.state = { status: entry.status === "empty" ? "manual-entry" : "invalid" };
      return;
    }

    if (Date.now() >= entry.expiresAt) {
      expireAuthorizationEntry(entry);
      this.state = { status: "invalid" };
      return;
    }

    this.request = entry.request;
    this.expiresAt = entry.expiresAt;
    this.state = { status: "review", review: entry.request.review };
    this.scheduleExpiration();
  }

  getState(): PassportAuthorizationViewState {
    return this.state;
  }

  subscribe(listener: (state: PassportAuthorizationViewState) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Releases an abandoned review and suppresses completion of in-flight work. */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.abortController.abort();
    this.clearExpirationTimer();
    if (this.request) IssuedPubkyAuthRequest.release(this.request);
    this.request = undefined;
    this.expiresAt = undefined;
    this.listeners.clear();
  }

  async approve(publicKeyZ32: string): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action) return this.state;

    const review = action.review;
    this.update({ status: "approving", review });
    const result = await approveAuthorization(
      action.request,
      publicKeyZ32,
      action.expiresAt,
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

    if (this.expiresAt === undefined || Date.now() >= this.expiresAt) {
      this.expire();
      return undefined;
    }

    this.clearExpirationTimer();
    return {
      request: this.request,
      expiresAt: this.expiresAt,
      review: this.state.review,
    };
  }

  private async completeRequestOutcome(
    request: IssuedPubkyAuthRequest,
    outcome: AuthorizationOutcome,
    review: AuthorizationRequestReview,
  ): Promise<PassportAuthorizationViewState> {
    if (this.disposed) {
      IssuedPubkyAuthRequest.release(request);
      return this.state;
    }

    this.request = undefined;
    this.expiresAt = undefined;
    const callback = IssuedPubkyAuthRequest.takeOutcomeCallback(request, outcome);
    if (!callback) return this.update(localStateForOutcome(outcome));

    this.update({ status: "completing", review });
    let completed = false;
    try {
      completed = await handoffAuthorizationOutcome(
        this.appWindow,
        callback,
        outcome,
        this.abortController.signal,
      );
    } catch {
      // Continue to the safe local outcome below.
    }
    if (completed) return this.state;

    LOGGER.warn("authorize.callback.failed", {
      outcome,
      operation: "complete",
    });
    return this.update(localStateForOutcome(outcome));
  }

  private scheduleExpiration(): void {
    if (this.expiresAt === undefined) return;
    const remainingLifetime = Math.max(0, this.expiresAt - Date.now());
    this.expirationTimer = this.appWindow.setTimeout(this.expire, remainingLifetime);
  }

  private expire = (): void => {
    if (!this.request || this.state.status !== "review" || this.expiresAt === undefined) {
      return;
    }

    if (Date.now() < this.expiresAt) {
      this.scheduleExpiration();
      return;
    }

    IssuedPubkyAuthRequest.release(this.request);
    this.request = undefined;
    this.expiresAt = undefined;
    this.clearExpirationTimer();
    this.update({ status: "invalid" });
  };

  private clearExpirationTimer(): void {
    if (this.expirationTimer !== undefined) {
      this.appWindow.clearTimeout(this.expirationTimer);
      this.expirationTimer = undefined;
    }
  }

  private update(state: PassportAuthorizationViewState): PassportAuthorizationViewState {
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        LOGGER.warn("authorize.state_listener.failed", { state: state.status });
      }
    }
    return state;
  }
}

function readAuthorizationEntry(appWindow: Window): AuthorizationEntry {
  const initialEntry = appWindow === window
    ? takeInitialAuthorizationEntry()
    : undefined;
  return initialEntry ?? readAndScrubAuthorizationEntry(appWindow);
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

export type { AuthorizationRequestReview } from "../request/IssuedPubkyAuthRequest";
