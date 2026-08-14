import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import type { HomeserverSignupInvitation } from "../../homegate/homegateClient";
import type { PubkyIdentityKey } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import type { SaveLocalIdentityOperation } from "../local/saveLocalIdentity";
import type { GoogleAccountProfile } from "./googleBackedIdentityCredentials";

export type ActivateGoogleBackedIdentityErrorCode =
  | "signup_failed"
  | "identity_mismatch"
  | "discovery_failed"
  | "local_save_failed";

export type ActivateGoogleBackedIdentityResult = ResultType<
  void,
  { code: ActivateGoogleBackedIdentityErrorCode }
>;

export type ActivateGoogleBackedIdentityProgress =
  | "signing_up_to_homeserver"
  | "publishing_discovery"
  | "activating_created_identity";

export type ReportActivateGoogleBackedIdentityProgress = (
  progress: ActivateGoogleBackedIdentityProgress,
) => void;

/** Signs up an existing Pubky key, publishes its homeserver, and saves it locally. */
export class ActivateGoogleBackedIdentity {
  constructor(private readonly dependencies: {
    pubky: PubkySdkAdapter;
    saveIdentityLocally: SaveLocalIdentityOperation;
  }) {}

  async execute(
    identity: PubkyIdentityKey,
    invitation: HomeserverSignupInvitation,
    reportProgress: ReportActivateGoogleBackedIdentityProgress,
    googleAccount?: GoogleAccountProfile,
  ): Promise<ActivateGoogleBackedIdentityResult> {
    reportProgress("signing_up_to_homeserver");
    LOGGER.info("identity.google.signup.started");
    const signedUp = await this.dependencies.pubky.signup({
      keyHandle: identity.keyHandle,
      homeserverPubky: invitation.homeserverPubky,
      signupCode: invitation.signupCode,
    });
    if (Result.isError(signedUp)) return failure("signup_failed");
    LOGGER.info("identity.google.signup.completed");

    if (signedUp.value.publicIdentity.publicKeyZ32 !== identity.publicIdentity.publicKeyZ32) {
      LOGGER.warn("identity.google.activation_identity.failed");
      return failure("identity_mismatch");
    }

    reportProgress("publishing_discovery");
    LOGGER.info("identity.google.discovery.started");
    const published = await this.dependencies.pubky.publishHomeserverIfStale({
      keyHandle: identity.keyHandle,
      homeserverPubky: invitation.homeserverPubky,
    });
    if (Result.isError(published)) return failure("discovery_failed");
    LOGGER.info("identity.google.discovery.completed");

    reportProgress("activating_created_identity");
    LOGGER.info("identity.local_save.started", { activation: "homeserver_signup" });
    const saved = await this.dependencies.saveIdentityLocally(identity.keyHandle, googleAccount);
    if (Result.isError(saved)) return failure("local_save_failed");
    LOGGER.info("identity.local_save.completed", { activation: "homeserver_signup" });

    return Result.ok();
  }
}

function failure(code: ActivateGoogleBackedIdentityErrorCode): ActivateGoogleBackedIdentityResult {
  return Result.err({ code });
}
