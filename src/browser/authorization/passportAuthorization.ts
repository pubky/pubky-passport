import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../libs/logger/logger";
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
} from "./passportAuthorizationController";
import { completeBrowserAuthorizationOutcome } from "./browserAuthorizationOutcome";

export type PassportAuthorizationController = Pick<
  PassportAuthorizationControllerImplementation,
  "getState" | "subscribe" | "commitInitialEntry" | "approve" | "cancel"
>;

export type {
  PassportAuthorizationFailureCode,
  PassportAuthorizationViewState,
} from "./passportAuthorizationController";
export type { AuthorizationRequestReview } from "./browserAuthorizationRequest";

export function createPassportAuthorizationController(): PassportAuthorizationController {
  const entry = takeBootstrappedAuthorizationEntry() ?? readAndScrubAuthorizationEntry(window);
  return new PassportAuthorizationControllerImplementation({
    entry,
    dependencies: {
      approveAuthorization: approveUsingActiveLocalIdentity,
      clearPendingEntry: () => clearPendingAuthorizationEntry(window),
      completeOutcome: (callback, outcome) =>
        completeBrowserAuthorizationOutcome(window, callback, outcome),
    },
  });
}

async function approveUsingActiveLocalIdentity(
  approval: Parameters<typeof approveAuthorizationWithActiveIdentity>[0]["approval"],
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
      repository.readActive.bind(repository),
      pubky,
    );
    return await approveAuthorizationWithActiveIdentity({
      approval,
      restoreActiveIdentity,
      pubky,
    });
  } finally {
    try {
      pubky.dispose();
    } catch {
      LOGGER.warn("authorize.cleanup.failed", { operation: "pubky_dispose" });
    }
  }
}
