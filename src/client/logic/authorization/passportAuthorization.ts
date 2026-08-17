import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "../identity/local/localStorageIdentityRepository";
import { RestoreActiveLocalIdentityKey } from "../identity/local/restoreActiveLocalIdentityKey";
import { PubkySdkAdapter } from "../pubky/pubkySdkAdapter";
import {
  approveAuthorizationWithActiveIdentity,
  type ApproveAuthorizationResult,
} from "./approveAuthorizationWithActiveIdentity";
import {
  clearPendingAuthorizationEntry,
  readAndScrubAuthorizationEntry,
} from "./browserAuthorizationEntry";
import { takeBootstrappedAuthorizationEntry } from "./browserAuthorizationBootstrap";
import {
  PassportAuthorizationController as PassportAuthorizationControllerImplementation,
  type PassportAuthorizationViewState,
} from "./passportAuthorizationController";
import { completeBrowserAuthorizationOutcome } from "./browserAuthorizationOutcome";

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
} from "./passportAuthorizationController";
export type { AuthorizationRequestReview } from "./browserAuthorizationRequest";

/** Creates the browser authorization flow without exposing sensitive request data. */
export function createPassportAuthorizationController(): PassportAuthorizationController {
  const entry = takeBootstrappedAuthorizationEntry() ?? readAndScrubAuthorizationEntry(window);
  return new PassportAuthorizationControllerImplementation(
    entry,
    approveUsingActiveLocalIdentity,
    () => clearPendingAuthorizationEntry(window),
    (callback, outcome) => completeBrowserAuthorizationOutcome(window, callback, outcome),
  );
}

async function approveUsingActiveLocalIdentity(
  approval: Parameters<typeof approveAuthorizationWithActiveIdentity>[0],
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
    return await approveAuthorizationWithActiveIdentity(
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
