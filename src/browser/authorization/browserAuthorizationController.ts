import "client-only";

import type { PubkyAuthRequestReview } from "../../features/auth/parsePubkyAuthRequest";
import type { ActiveAuthorizationErrorCode } from "./approveActiveAuthorization";

export type BrowserAuthorizationViewState =
  | { status: "invalid" }
  | { status: "review"; review: PubkyAuthRequestReview }
  | { status: "approving"; review: PubkyAuthRequestReview }
  | { status: "redirecting"; review: PubkyAuthRequestReview }
  | { status: "approved" }
  | { status: "cancelled" }
  | { status: "failed"; failureCode: ActiveAuthorizationErrorCode };

export type BrowserAuthorizationController = {
  getState(): BrowserAuthorizationViewState;
  subscribe(listener: (state: BrowserAuthorizationViewState) => void): () => void;
  mounted(): void;
  approve(): Promise<BrowserAuthorizationViewState>;
  cancel(): BrowserAuthorizationViewState;
};
