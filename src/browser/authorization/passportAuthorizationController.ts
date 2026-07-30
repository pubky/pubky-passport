import "client-only";

import { Result } from "better-result";

import {
  getParserIssuedPubkyAuthCallbacks,
  type ValidatedSensitivePubkyAuthRequest,
} from "../../core/auth/parsePubkyAuthRequest";
import { LOGGER } from "../../libs/logger/logger";
import type { ParsedAuthorizationEntry } from "./application/authorizationEntry";
import type {
  ActiveAuthorizationErrorCode,
  ActiveAuthorizationResult,
} from "./application/approveActiveAuthorization";
import type {
  BrowserAuthorizationController,
  BrowserAuthorizationFailureCode,
  BrowserAuthorizationViewState,
} from "./browserAuthorizationController";

export type PassportAuthorizationControllerDependencies = {
  approveAuthorization(approval: ValidatedSensitivePubkyAuthRequest): Promise<ActiveAuthorizationResult>;
  commitAuthorizationEntry(): void;
  navigate(url: string): void;
};

export class PassportAuthorizationController implements BrowserAuthorizationController {
  readonly #entry: ParsedAuthorizationEntry;
  readonly #dependencies: PassportAuthorizationControllerDependencies;
  readonly #listeners = new Set<(state: BrowserAuthorizationViewState) => void>();
  #state: BrowserAuthorizationViewState;
  #approvalPending = false;

  constructor(input: {
    entry: ParsedAuthorizationEntry;
    dependencies: PassportAuthorizationControllerDependencies;
  }) {
    this.#entry = input.entry;
    this.#dependencies = input.dependencies;
    this.#state = input.entry.status === "valid"
      ? { status: "review", review: input.entry.review }
      : { status: "invalid" };
  }

  getState(): BrowserAuthorizationViewState {
    return this.#state;
  }

  subscribe(listener: (state: BrowserAuthorizationViewState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  mounted(): void {
    this.#dependencies.commitAuthorizationEntry();
  }

  async approve(): Promise<BrowserAuthorizationViewState> {
    if (this.#entry.status !== "valid" || this.#approvalPending || this.#state.status !== "review") {
      return this.#state;
    }

    this.#approvalPending = true;
    this.update({ status: "approving", review: this.#entry.review });
    let result: ActiveAuthorizationResult;
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
        const success = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.success;
        if (success && this.tryNavigate(success, "success")) {
          return this.update({ status: "redirecting", review: this.#entry.review });
        }
        return this.update({ status: "approved" });
      }

      const errorCallback = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.error;
      if (errorCallback && this.tryNavigate(errorCallback, "error")) {
        return this.update({ status: "redirecting", review: this.#entry.review });
      }
      return this.update({
        status: "failed",
        failureCode: browserAuthorizationFailureCode(result.error.code),
      });
    } catch {
      LOGGER.warn("authorize.callback.failed", {
        outcome: Result.isOk(result) ? "success" : "error",
        operation: "callback_lookup",
      });
      return this.update({ status: "failed", failureCode: "approval_failed" });
    }
  }

  cancel(): BrowserAuthorizationViewState {
    if (this.#entry.status !== "valid" || this.#approvalPending || this.#state.status !== "review") {
      return this.#state;
    }

    try {
      const cancelCallback = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.cancel;
      if (cancelCallback && this.tryNavigate(cancelCallback, "cancel")) {
        return this.update({ status: "redirecting", review: this.#entry.review });
      }
    } catch {
      LOGGER.warn("authorize.callback.failed", {
        outcome: "cancel",
        operation: "callback_lookup",
      });
    }
    return this.update({ status: "cancelled" });
  }

  private tryNavigate(url: string, outcome: "success" | "error" | "cancel"): boolean {
    try {
      this.#dependencies.navigate(url);
      return true;
    } catch {
      LOGGER.warn("authorize.callback.failed", {
        outcome,
        operation: "navigate",
      });
      return false;
    }
  }

  private update(state: BrowserAuthorizationViewState): BrowserAuthorizationViewState {
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

function browserAuthorizationFailureCode(
  code: ActiveAuthorizationErrorCode,
): BrowserAuthorizationFailureCode {
  switch (code) {
    case "no_active_identity":
    case "identity_restore_failed":
    case "approval_failed":
      return code;
  }
}
