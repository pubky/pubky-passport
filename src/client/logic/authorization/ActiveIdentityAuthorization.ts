import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityErrorCode,
} from "../local-identity/LocalStorageIdentityRepository";
import type {
  PubkyIdentityKey,
  PubkyPublicIdentity,
} from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../pubky/PubkySdkAdapter";
import type { IssuedPubkyAuthRequest } from "./IssuedPubkyAuthRequest";

export type ApproveAuthorizationErrorCode =
  | "no_active_identity"
  | "identity_restore_failed"
  | "approval_failed";

export type ApproveAuthorizationResult = ResultType<void, { code: ApproveAuthorizationErrorCode }>;

type CreatePubkySdkAdapter = () => PubkySdkAdapter;
type RestoreActiveIdentity = (
  pubky: PubkySdkAdapter,
) => Promise<RestoreActiveIdentityResult>;

/**
 * Restores the active local key, approves one validated request with the same
 * Pubky adapter, and always disposes the restored key handle.
 */
export class ActiveIdentityAuthorization {
  constructor(
    private createPubky: CreatePubkySdkAdapter = () => new PubkySdkAdapter(),
    private restoreActiveIdentity: RestoreActiveIdentity = restoreActiveLocalIdentity,
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
      return await this.approveWithRestoredIdentity(request, pubky);
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
    pubky: PubkySdkAdapter,
  ): Promise<ApproveAuthorizationResult> {
    let keyHandle: PubkyIdentityKey["keyHandle"] | undefined;

    try {
      const restored = await this.restoreActiveIdentity(pubky);
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

type ReadActiveIdentity = LocalStorageIdentityRepository["readActive"];
type RestoreActiveIdentityResult = ResultType<
  PubkyIdentityKey,
  { code: LocalIdentityErrorCode | "identity_mismatch" | "restore_failed" }
>;

/** Restores and verifies the local key needed for one authorization attempt. */
export async function restoreActiveLocalIdentity(
  pubky: PubkySdkAdapter,
  readActive: ReadActiveIdentity = createActiveIdentityReader(),
): Promise<RestoreActiveIdentityResult> {
  const stored = readActive();
  if (Result.isError(stored)) return Result.err(stored.error);

  try {
    const restored = await pubky.restoreIdentityKey(stored.value.secretKey);
    if (Result.isError(restored)) return Result.err({ code: "restore_failed" });

    if (!isSamePublicIdentity(restored.value.publicIdentity, stored.value.identity.publicIdentity)) {
      try {
        pubky.disposeIdentityKey(restored.value.keyHandle);
      } catch {
        LOGGER.warn("authorize.cleanup.failed", { operation: "identity_key_dispose" });
      }
      LOGGER.warn("identity.local_restore.failed", { code: "identity_mismatch" });
      return Result.err({ code: "identity_mismatch" });
    }

    return Result.ok(restored.value);
  } finally {
    stored.value.secretKey.bytes.fill(0);
  }
}

function createActiveIdentityReader(): ReadActiveIdentity {
  const repository = new LocalStorageIdentityRepository();
  return () => repository.readActive();
}

function isSamePublicIdentity(left: PubkyPublicIdentity, right: PubkyPublicIdentity): boolean {
  return left.publicKeyZ32 === right.publicKeyZ32
    && left.publicKeyDisplay === right.publicKeyDisplay;
}
