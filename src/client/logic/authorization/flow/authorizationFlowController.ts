import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import type { AuthorizationEntry } from "../entry/authorizationEntry";
import {
  getValidatedOutcomeCallback,
  releaseAuthorizationApproval,
  type AuthorizationOutcome,
  type AuthorizationRequestReview,
  type PubkyAuthApprovalCapability,
} from "../request/issuedAuthorizationRequest";
import type {
  ApproveAuthorizationErrorCode,
  ApproveAuthorizationResult,
} from "./approveWithActiveIdentity";

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

type AuthorizationFlowDependencies = {
  approveAuthorization: (
    approval: PubkyAuthApprovalCapability,
  ) => Promise<ApproveAuthorizationResult>;
  clearPendingEntry: () => void;
  completeOutcome: (
    callback: string,
    outcome: AuthorizationOutcome,
  ) => Promise<boolean>;
};

type CallbackResolution =
  | { status: "available"; callback: string }
  | { status: "missing" }
  | { status: "failed" };

/**
 * Coordinates review, approval, and terminal callback handling.
 *
 * The approval capability contains no request data. Its sensitive metadata remains
 * in the request module and is released as soon as the SDK and outcome callback
 * selection no longer need it.
 */
export class AuthorizationFlowController {
  private listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  private state: PassportAuthorizationViewState;
  private approval: PubkyAuthApprovalCapability | undefined;
  private readonly dependencies: AuthorizationFlowDependencies;

  constructor(
    entry: AuthorizationEntry,
    dependencies: AuthorizationFlowDependencies,
  ) {
    this.approval = entry.status === "valid" ? entry.approval : undefined;
    this.dependencies = dependencies;
    this.state = entry.status === "valid"
      ? { status: "review", review: entry.review }
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
    this.dependencies.clearPendingEntry();
  }

  async approve(): Promise<PassportAuthorizationViewState> {
    const approval = this.approval;
    if (!approval || this.state.status !== "review") return this.state;

    const review = this.state.review;
    this.update({ status: "approving", review });
    const result = await this.approveSafely(approval);
    const outcome = Result.isOk(result) ? "success" : "error";
    const callback = this.resolveAndReleaseCallback(approval, outcome);

    if (callback.status === "failed") {
      return this.update({ status: "failed", failureCode: "approval_failed" });
    }
    if (callback.status === "available") {
      this.update({ status: "redirecting", review });
      if (await this.tryCompleteOutcome(callback.callback, outcome)) return this.state;
    }

    return Result.isOk(result)
      ? this.update({ status: "approved" })
      : this.update({ status: "failed", failureCode: result.error.code });
  }

  async cancel(): Promise<PassportAuthorizationViewState> {
    const approval = this.approval;
    if (!approval || this.state.status !== "review") return this.state;

    const review = this.state.review;
    const callback = this.resolveAndReleaseCallback(approval, "cancel");
    if (callback.status === "available") {
      this.update({ status: "redirecting", review });
      if (await this.tryCompleteOutcome(callback.callback, "cancel")) return this.state;
    }

    return this.update({ status: "cancelled" });
  }

  private async approveSafely(
    approval: PubkyAuthApprovalCapability,
  ): Promise<ApproveAuthorizationResult> {
    try {
      return await this.dependencies.approveAuthorization(approval);
    } catch {
      LOGGER.warn("authorize.approval.failed", {
        stage: "controller",
        code: "unexpected_failure",
      });
      return Result.err({ code: "approval_failed" });
    }
  }

  private resolveAndReleaseCallback(
    approval: PubkyAuthApprovalCapability,
    outcome: AuthorizationOutcome,
  ): CallbackResolution {
    try {
      const callback = getValidatedOutcomeCallback(approval, outcome);
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
      this.approval = undefined;
      releaseAuthorizationApproval(approval);
    }
  }

  private async tryCompleteOutcome(
    callback: string,
    outcome: AuthorizationOutcome,
  ): Promise<boolean> {
    try {
      if (await this.dependencies.completeOutcome(callback, outcome)) {
        return true;
      }
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
