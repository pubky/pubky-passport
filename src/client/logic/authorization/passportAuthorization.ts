import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "../identity/local/localStorageIdentityRepository";
import { RestoreActiveLocalIdentityKey } from "../identity/local/restoreActiveLocalIdentityKey";
import { PubkySdkAdapter } from "../pubky/pubkySdkAdapter";
import {
  approveWithActiveIdentity,
  type ApproveAuthorizationResult,
} from "./flow/approveWithActiveIdentity";
import {
  clearPendingAuthorizationEntry,
  readAndScrubAuthorizationEntry,
} from "./entry/authorizationEntry";
import { takeInitialAuthorizationEntry } from "./entry/authorizationEntryBootstrap";
import {
  AuthorizationFlowController,
  type PassportAuthorizationViewState,
} from "./flow/authorizationFlowController";
import { completeAuthorizationOutcome } from "./flow/completeAuthorizationOutcome";

/** UI-safe authorization state and user intents exposed to React. */
export type PassportAuthorizationController = {
  getState(): PassportAuthorizationViewState;
  subscribe(listener: (state: PassportAuthorizationViewState) => void): () => void;
  commitInitialEntry(): void;
  approve(): Promise<PassportAuthorizationViewState>;
  cancel(): Promise<PassportAuthorizationViewState>;
};

export type {
  PassportAuthorizationFailureCode,
  PassportAuthorizationViewState,
} from "./flow/authorizationFlowController";
export type { AuthorizationRequestReview } from "./request/issuedAuthorizationRequest";

/** Creates the authorization flow without exposing sensitive request data. */
export function createPassportAuthorizationController(): PassportAuthorizationController {
  const entry = takeInitialAuthorizationEntry() ?? readAndScrubAuthorizationEntry(window);
  return new AuthorizationFlowController(entry, {
    approveAuthorization: approveUsingActiveLocalIdentity,
    clearPendingEntry: () => clearPendingAuthorizationEntry(window),
    completeOutcome: (callback, outcome) => completeAuthorizationOutcome(
      window,
      callback,
      outcome,
    ),
  });
}

async function approveUsingActiveLocalIdentity(
  approval: Parameters<typeof approveWithActiveIdentity>[0],
): Promise<ApproveAuthorizationResult> {
  let pubky: PubkySdkAdapter;
  try {
    pubky = new PubkySdkAdapter();
  } catch {
    LOGGER.warn("authorize.approval.failed", {
      stage: "sdk_initialize",
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed" });
  }

  try {
    const repository = new LocalStorageIdentityRepository();
    const restoreActiveIdentity = new RestoreActiveLocalIdentityKey(
      () => repository.readActive(),
      pubky,
    );
    return await approveWithActiveIdentity(
      approval,
      restoreActiveIdentity,
      pubky,
    );
  } finally {
    try {
      pubky.dispose();
    } catch {
      LOGGER.warn("authorize.cleanup.failed", { operation: "pubky_dispose" });
    }
  }
}
