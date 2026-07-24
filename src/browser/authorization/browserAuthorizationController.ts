import "client-only";

import type { PubkyAuthRequestReview } from "../../core/auth/parsePubkyAuthRequest";

export type BrowserAuthorizationFailureCode =
  | "no_active_identity"
  | "identity_restore_failed"
  | "approval_failed";

export type BrowserAuthorizationViewState =
  | { status: "invalid" }
  | { status: "review"; review: PubkyAuthRequestReview }
  | { status: "approving"; review: PubkyAuthRequestReview }
  | { status: "redirecting"; review: PubkyAuthRequestReview }
  | { status: "approved" }
  | { status: "cancelled" }
  | { status: "failed"; failureCode: BrowserAuthorizationFailureCode };

export type BrowserAuthorizationController = {
  getState(): BrowserAuthorizationViewState;
  subscribe(listener: (state: BrowserAuthorizationViewState) => void): () => void;
  mounted(): void;
  approve(): Promise<BrowserAuthorizationViewState>;
  cancel(): BrowserAuthorizationViewState;
};
