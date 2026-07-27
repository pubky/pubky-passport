import "client-only";

import { Result } from "better-result";

import {
  getParserIssuedPubkyAuthCallbacks,
  type ValidatedSensitivePubkyAuthRequest,
} from "../../core/auth/parsePubkyAuthRequest";
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
      result = Result.err({ code: "approval_failed" });
    }

    try {
      if (Result.isOk(result)) {
        const success = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.success;
        if (success && this.tryNavigate(success)) {
          return this.update({ status: "redirecting", review: this.#entry.review });
        }
        return this.update({ status: "approved" });
      }

      const errorCallback = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.error;
      if (errorCallback && this.tryNavigate(errorCallback)) {
        return this.update({ status: "redirecting", review: this.#entry.review });
      }
      return this.update({
        status: "failed",
        failureCode: browserAuthorizationFailureCode(result.error.code),
      });
    } catch {
      return this.update({ status: "failed", failureCode: "approval_failed" });
    }
  }

  cancel(): BrowserAuthorizationViewState {
    if (this.#entry.status !== "valid" || this.#approvalPending || this.#state.status !== "review") {
      return this.#state;
    }

    try {
      const cancelCallback = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.cancel;
      if (cancelCallback && this.tryNavigate(cancelCallback)) {
        return this.update({ status: "redirecting", review: this.#entry.review });
      }
    } catch {
      // Callback retrieval and navigation failures always terminate locally.
    }
    return this.update({ status: "cancelled" });
  }

  private tryNavigate(url: string): boolean {
    try {
      this.#dependencies.navigate(url);
      return true;
    } catch {
      return false;
    }
  }

  private update(state: BrowserAuthorizationViewState): BrowserAuthorizationViewState {
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // Rendering consumers cannot make controller intents reject or throw.
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
