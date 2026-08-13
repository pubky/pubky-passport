import "client-only";

import { Result } from "better-result";

import {
  getValidatedAuthorizationCallbacks,
  type AuthorizationRequestReview,
  type PubkyAuthApprovalCapability,
} from "./browserAuthorizationRequest";
import { LOGGER } from "../../../libs/logger/logger";
import type { AuthorizationEntry } from "./browserAuthorizationEntry";
import type {
  ApproveAuthorizationErrorCode,
  ApproveAuthorizationResult,
} from "./approveAuthorizationWithActiveIdentity";
import type { BrowserAuthorizationOutcome } from "./browserAuthorizationOutcome";

export type PassportAuthorizationFailureCode = ApproveAuthorizationErrorCode;

export type PassportAuthorizationViewState =
  | { status: "manual-entry" }
  | { status: "invalid" }
  | { status: "review"; review: AuthorizationRequestReview }
  | { status: "approving"; review: AuthorizationRequestReview }
  | { status: "redirecting"; review: AuthorizationRequestReview }
  | { status: "approved" }
  | { status: "cancelled" }
  | { status: "failed"; failureCode: PassportAuthorizationFailureCode };

type PassportAuthorizationControllerDependencies = {
  approveAuthorization(approval: PubkyAuthApprovalCapability): Promise<ApproveAuthorizationResult>;
  clearPendingEntry(): void;
  completeOutcome(callback: string, outcome: BrowserAuthorizationOutcome): Promise<boolean>;
};

export class PassportAuthorizationController {
  readonly #entry: AuthorizationEntry;
  readonly #dependencies: PassportAuthorizationControllerDependencies;
  readonly #listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  #state: PassportAuthorizationViewState;
  #approvalPending = false;

  constructor(input: {
    entry: AuthorizationEntry;
    dependencies: PassportAuthorizationControllerDependencies;
  }) {
    this.#entry = input.entry;
    this.#dependencies = input.dependencies;
    this.#state = input.entry.status === "valid"
      ? { status: "review", review: input.entry.review }
      : { status: input.entry.status === "empty" ? "manual-entry" : "invalid" };
  }

  getState(): PassportAuthorizationViewState {
    return this.#state;
  }

  subscribe(listener: (state: PassportAuthorizationViewState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  commitInitialEntry(): void {
    this.#dependencies.clearPendingEntry();
  }

  async approve(): Promise<PassportAuthorizationViewState> {
    if (this.#entry.status !== "valid" || this.#approvalPending || this.#state.status !== "review") {
      return this.#state;
    }

    this.#approvalPending = true;
    this.update({ status: "approving", review: this.#entry.review });
    let result: ApproveAuthorizationResult;
    try {
      result = await this.#dependencies.approveAuthorization(this.#entry.approval);
    } catch {
      LOGGER.warn("authorize.approval.failed", {
        stage: "controller",
        code: "unexpected_failure",
      });
      result = Result.err({ code: "approval_failed" });
    }

    try {
      if (Result.isOk(result)) {
        const success = getValidatedAuthorizationCallbacks(this.#entry.approval)?.success;
        if (success) {
          this.update({ status: "redirecting", review: this.#entry.review });
          if (await this.tryCompleteOutcome(success, "success")) return this.#state;
        }
        return this.update({ status: "approved" });
      }

      const errorCallback = getValidatedAuthorizationCallbacks(this.#entry.approval)?.error;
      if (errorCallback) {
        this.update({ status: "redirecting", review: this.#entry.review });
        if (await this.tryCompleteOutcome(errorCallback, "error")) return this.#state;
      }
      return this.update({
        status: "failed",
        failureCode: result.error.code,
      });
    } catch {
      LOGGER.warn("authorize.callback.failed", {
        outcome: Result.isOk(result) ? "success" : "error",
        operation: "callback_lookup",
      });
      return this.update({ status: "failed", failureCode: "approval_failed" });
    }
  }

  async cancel(): Promise<PassportAuthorizationViewState> {
    if (this.#entry.status !== "valid" || this.#approvalPending || this.#state.status !== "review") {
      return this.#state;
    }

    try {
      const cancelCallback = getValidatedAuthorizationCallbacks(this.#entry.approval)?.cancel;
      if (cancelCallback) {
        this.update({ status: "redirecting", review: this.#entry.review });
        if (await this.tryCompleteOutcome(cancelCallback, "cancel")) return this.#state;
      }
    } catch {
      LOGGER.warn("authorize.callback.failed", {
        outcome: "cancel",
        operation: "callback_lookup",
      });
    }
    return this.update({ status: "cancelled" });
  }

  private async tryCompleteOutcome(url: string, outcome: BrowserAuthorizationOutcome): Promise<boolean> {
    try {
      const completed = await this.#dependencies.completeOutcome(url, outcome);
      if (completed) return true;
    } catch {
      // The safe local outcome below remains available when completion throws.
    }
    LOGGER.warn("authorize.callback.failed", {
      outcome,
      operation: "complete",
    });
    return false;
  }

  private update(state: PassportAuthorizationViewState): PassportAuthorizationViewState {
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        LOGGER.warn("authorize.state_listener.failed", { state: state.status });
      }
    }
    return state;
  }
}
