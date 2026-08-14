import "client-only";

import { Result, type Result as ResultType } from "better-result";
import type { GoogleAccountProfile } from "./googleBackedIdentityCredentials";

import type { PubkyPublicIdentity } from "../pubkyPublicIdentity";
import type { PubkyIdentityKey } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import type { SaveLocalIdentityOperation } from "../local/saveLocalIdentity";
import type { RestoreGoogleBackedIdentityKey } from "./restoreGoogleBackedIdentityKey";

export type RestoredGoogleBackedIdentity = {
  establishmentMode: "restored";
  publicIdentity: PubkyPublicIdentity;
};

export type RestoreGoogleBackedIdentityError = {
  code: "decrypt_failed" | "restore_failed" | "signin_failed" | "identity_mismatch" | "discovery_failed" | "local_save_failed";
  preservedPassportFileIdentity?: PubkyPublicIdentity;
};

export type RestoreGoogleBackedIdentityResult<Success = RestoredGoogleBackedIdentity> = ResultType<
  Success,
  RestoreGoogleBackedIdentityError
>;

export type RestoreGoogleBackedIdentityProgress =
  | "restoring_identity"
  | "activating_restored_identity";

export type ReportRestoreGoogleBackedIdentityProgress = (
  progress: RestoreGoogleBackedIdentityProgress,
) => void;

export class RestoreGoogleBackedIdentity {
  constructor(
    private restoreIdentityKey: RestoreGoogleBackedIdentityKey["execute"],
    private pubky: PubkySdkAdapter,
    private saveIdentityLocally: SaveLocalIdentityOperation,
  ) { }

  async execute(
    envelope: PassportFileEnvelopeV1,
    wrappingKey: string,
    reportProgress: ReportRestoreGoogleBackedIdentityProgress,
    googleAccount?: GoogleAccountProfile,
  ): Promise<RestoreGoogleBackedIdentityResult> {
    reportProgress("restoring_identity");
    let restoredIdentity: PubkyIdentityKey | null = null;
    try {
      const restored = await this.restoreIdentityKey(envelope, wrappingKey);
      if (Result.isError(restored)) return failure(restored.error.code);
      restoredIdentity = restored.value;
      const restoredPublicIdentity = restored.value.publicIdentity;

      reportProgress("activating_restored_identity");
      const signedIn = await this.pubky.signin(restored.value.keyHandle);
      if (Result.isError(signedIn)) return failure("signin_failed", restoredPublicIdentity);
      if (signedIn.value.publicIdentity.publicKeyZ32 !== restoredPublicIdentity.publicKeyZ32) {
        LOGGER.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch", restoredPublicIdentity);
      }

      let published = await this.pubky.publishHomeserverIfStale({
        keyHandle: restored.value.keyHandle,
      });
      if (Result.isError(published)) {
        published = await this.pubky.publishHomeserverIfStale({
          keyHandle: restored.value.keyHandle,
        });
      }
      if (Result.isError(published)) return failure("discovery_failed", restoredPublicIdentity);

      LOGGER.info("identity.local_save.started", { establishmentMode: "restored" });
      const saved = await this.saveIdentityLocally(restored.value.keyHandle, googleAccount);
      if (Result.isError(saved)) return failure("local_save_failed", restoredPublicIdentity);

      LOGGER.info("identity.local_save.completed", { establishmentMode: "restored" });
      return Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: restored.value.publicIdentity,
      });
    } finally {
      if (restoredIdentity) {
        try {
          this.pubky.disposeIdentityKey(restoredIdentity.keyHandle);
        } catch {
          LOGGER.warn("identity.google.cleanup.failed", { operation: "restored_key_dispose" });
        }
      }
    }
  }
}

function failure<Success>(
  code: RestoreGoogleBackedIdentityError["code"],
  preservedPassportFileIdentity?: PubkyPublicIdentity,
): RestoreGoogleBackedIdentityResult<Success> {
  return Result.err({
    code,
    ...(preservedPassportFileIdentity ? { preservedPassportFileIdentity } : {}),
  });
}
