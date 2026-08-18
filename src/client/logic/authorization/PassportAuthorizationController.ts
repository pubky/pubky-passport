import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import {
  ActiveIdentityAuthorization,
  type ApproveAuthorizationErrorCode,
  type ApproveAuthorizationResult,
} from "./ActiveIdentityAuthorization";
import {
  AuthorizationOutcomeHandoff,
  type AuthorizationOutcome,
} from "./AuthorizationOutcomeHandoff";
import {
  clearPendingAuthorizationEntry,
  readAndScrubAuthorizationEntry,
} from "./authorizationEntry";
import { takeInitialAuthorizationEntry } from "./authorizationEntryBootstrap";
import {
  type AuthorizationRequestReview,
  IssuedPubkyAuthRequest,
} from "./IssuedPubkyAuthRequest";

export type PassportAuthorizationFailureCode = ApproveAuthorizationErrorCode;

/** Finite, render-safe states emitted by the authorization controller. */
export type PassportAuthorizationViewState =
  | { status: "manual-entry" }
  | { status: "invalid" }
  | { status: "review"; review: AuthorizationRequestReview }
  | { status: "approving"; review: AuthorizationRequestReview }
  | { status: "redirecting"; review: AuthorizationRequestReview }
  | { status: "approved" }
  | { status: "cancelled" }
  | { status: "failed"; failureCode: PassportAuthorizationFailureCode };

type CallbackResolution =
  | { status: "available"; callback: string }
  | { status: "missing" }
  | { status: "failed" };

/**
 * Public authorization entry used by React.
 *
 * The controller owns request review state and user intents. Request secrets and
 * complete callbacks remain private to the exact `IssuedPubkyAuthRequest` instance.
 */
export class PassportAuthorizationController {
  private listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  private state: PassportAuthorizationViewState;
  private request: IssuedPubkyAuthRequest | undefined;
  private readonly activeIdentityAuthorization: ActiveIdentityAuthorization;
  private readonly outcomeHandoff: AuthorizationOutcomeHandoff;

  constructor(private appWindow: Window = window) {
    const entry = takeInitialAuthorizationEntry()
      ?? readAndScrubAuthorizationEntry(appWindow);

    this.request = entry.status === "valid"
      ? entry.request
      : undefined;
    this.activeIdentityAuthorization = new ActiveIdentityAuthorization();
    this.outcomeHandoff = new AuthorizationOutcomeHandoff(appWindow);
    this.state = entry.status === "valid"
      ? { status: "review", review: entry.request.review }
      : { status: entry.status === "empty" ? "manual-entry" : "invalid" };
  }

  getState(): PassportAuthorizationViewState {
    return this.state;
  }

  subscribe(listener: (state: PassportAuthorizationViewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  commitInitialEntry(): void {
    clearPendingAuthorizationEntry(this.appWindow);
  }

  async approve(): Promise<PassportAuthorizationViewState> {
    const request = this.request;
    if (!request || this.state.status !== "review") return this.state;

    const review = this.state.review;
    this.update({ status: "approving", review });
    const result = await this.approveSafely(request);
    const outcome = Result.isOk(result) ? "success" : "error";
    const callback = this.takeOutcomeCallback(request, outcome);

    if (callback.status === "failed") {
      return this.update({ status: "failed", failureCode: "approval_failed" });
    }
    if (callback.status === "available") {
      this.update({ status: "redirecting", review });
      if (await this.completeOutcome(callback.callback, outcome)) return this.state;
    }

    return Result.isOk(result)
      ? this.update({ status: "approved" })
      : this.update({ status: "failed", failureCode: result.error.code });
  }

  async cancel(): Promise<PassportAuthorizationViewState> {
    const request = this.request;
    if (!request || this.state.status !== "review") return this.state;

    const review = this.state.review;
    const callback = this.takeOutcomeCallback(request, "cancel");
    if (callback.status === "available") {
      this.update({ status: "redirecting", review });
      if (await this.completeOutcome(callback.callback, "cancel")) return this.state;
    }

    return this.update({ status: "cancelled" });
  }

  private async approveSafely(
    request: IssuedPubkyAuthRequest,
  ): Promise<ApproveAuthorizationResult> {
    try {
      return await this.activeIdentityAuthorization.approve(request);
    } catch {
      LOGGER.warn("authorize.approval.failed", {
        stage: "controller",
        code: "unexpected_failure",
      });
      return Result.err({ code: "approval_failed" });
    }
  }

  private takeOutcomeCallback(
    request: IssuedPubkyAuthRequest,
    outcome: AuthorizationOutcome,
  ): CallbackResolution {
    try {
      const callback = IssuedPubkyAuthRequest.takeOutcomeCallback(request, outcome);
      return callback === undefined
        ? { status: "missing" }
        : { status: "available", callback };
    } catch {
      LOGGER.warn("authorize.callback.failed", {
        outcome,
        operation: "callback_lookup",
      });
      return { status: "failed" };
    } finally {
      this.request = undefined;
      IssuedPubkyAuthRequest.release(request);
    }
  }

  private async completeOutcome(
    callback: string,
    outcome: AuthorizationOutcome,
  ): Promise<boolean> {
    try {
      if (await this.outcomeHandoff.complete(callback, outcome)) return true;
    } catch {
      // A safe local terminal state remains available below.
    }
    LOGGER.warn("authorize.callback.failed", {
      outcome,
      operation: "complete",
    });
    return false;
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

export type { AuthorizationRequestReview } from "./IssuedPubkyAuthRequest";
