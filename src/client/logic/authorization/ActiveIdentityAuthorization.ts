import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { RestoreActiveLocalIdentityKey } from "../identity/local/RestoreActiveLocalIdentityKey";
import { LocalStorageIdentityRepository } from "../identity/local/LocalStorageIdentityRepository";
import type { PubkyIdentityKey } from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../pubky/PubkySdkAdapter";
import type { IssuedPubkyAuthRequest } from "./IssuedPubkyAuthRequest";

export type ApproveAuthorizationErrorCode =
  | "no_active_identity"
  | "identity_restore_failed"
  | "approval_failed";

export type ApproveAuthorizationResult = ResultType<void, { code: ApproveAuthorizationErrorCode }>;

type CreatePubkySdkAdapter = () => PubkySdkAdapter;
type CreateActiveIdentityRestorer = (
  pubky: PubkySdkAdapter,
) => RestoreActiveLocalIdentityKey;

/**
 * Restores the active local key, approves one validated request with the same
 * Pubky adapter, and always disposes the restored key handle.
 */
export class ActiveIdentityAuthorization {
  constructor(
    private createPubky: CreatePubkySdkAdapter = () => new PubkySdkAdapter(),
    private createActiveIdentityRestorer: CreateActiveIdentityRestorer = (pubky) => {
      const repository = new LocalStorageIdentityRepository();
      return new RestoreActiveLocalIdentityKey(
        () => repository.readActive(),
        pubky,
      );
    },
  ) {}

  async approve(request: IssuedPubkyAuthRequest): Promise<ApproveAuthorizationResult> {
    let pubky: PubkySdkAdapter;
    try {
      pubky = this.createPubky();
    } catch {
      LOGGER.warn("authorize.approval.failed", {
        stage: "sdk_initialize",
        code: "unexpected_failure",
      });
      return Result.err({ code: "approval_failed" });
    }

    try {
      let restoreActiveIdentity: RestoreActiveLocalIdentityKey;
      try {
        restoreActiveIdentity = this.createActiveIdentityRestorer(pubky);
      } catch {
        LOGGER.warn("authorize.approval.failed", {
          stage: "identity_restore",
          code: "unexpected_failure",
        });
        return Result.err({ code: "identity_restore_failed" });
      }
      return await this.approveWithRestoredIdentity(
        request,
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

  private async approveWithRestoredIdentity(
    request: IssuedPubkyAuthRequest,
    restoreActiveIdentity: RestoreActiveLocalIdentityKey,
    pubky: PubkySdkAdapter,
  ): Promise<ApproveAuthorizationResult> {
    let keyHandle: PubkyIdentityKey["keyHandle"] | undefined;

    try {
      const restored = await restoreActiveIdentity.restore();
      if (Result.isError(restored)) {
        return Result.err({
          code: restored.error.code === "no_active_identity"
            ? "no_active_identity"
            : "identity_restore_failed",
        });
      }

      keyHandle = restored.value.keyHandle;
      const approved = await pubky.approveAuthRequest(keyHandle, request);

      if (Result.isError(approved)) return Result.err({ code: "approval_failed" });
      return Result.ok();
    } catch {
      LOGGER.warn("authorize.approval.failed", {
        stage: keyHandle ? "sdk_approve" : "identity_restore",
        code: "unexpected_failure",
      });
      return Result.err({ code: keyHandle ? "approval_failed" : "identity_restore_failed" });
    } finally {
      if (keyHandle) {
        try {
          pubky.disposeIdentityKey(keyHandle);
        } catch {
          LOGGER.warn("authorize.cleanup.failed", { operation: "identity_key_dispose" });
        }
      }
    }
  }
}
