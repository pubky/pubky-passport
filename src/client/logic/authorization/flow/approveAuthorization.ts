import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import type { CodedFailure } from "../../../../libs/result";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityErrorCode,
} from "../../local-identity/LocalStorageIdentityRepository";
import type { PubkyIdentityKey, PubkyPublicIdentity } from "../../pubky/pubkyIdentityKey";
import type { PubkySdkAdapter } from "../../pubky/PubkySdkAdapter";
import type { ValidatedPubkyAuthRequest } from "../request/ValidatedPubkyAuthRequest";

type ApproveAuthorizationResult = ResultType<void, CodedFailure<"approval_failed" | "cancelled">>;

type RestoreLocalIdentityResult = ResultType<
  PubkyIdentityKey,
  CodedFailure<RestoreLocalIdentityErrorCode>
>;

type RestoreLocalIdentityErrorCode =
  LocalIdentityErrorCode | "identity_mismatch" | "restore_failed";

/** Approves one request with the exact local identity selected during review. */
export async function approveAuthorization(
  request: ValidatedPubkyAuthRequest,
  publicKeyZ32: string,
  signal?: AbortSignal,
  onCommit?: () => void,
): Promise<ApproveAuthorizationResult> {
  if (signal?.aborted) return Result.err({ code: "cancelled" });
  let pubky: PubkySdkAdapter;
  try {
    const { PubkySdkAdapter } = await import("../../pubky/PubkySdkAdapter");
    if (signal?.aborted) return Result.err({ code: "cancelled" });
    pubky = new PubkySdkAdapter();
  } catch {
    LOGGER.warn("authorize.approval.failed", {
      stage: "sdk_initialize",
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed" });
  }

  let keyHandle: PubkyIdentityKey["keyHandle"] | undefined;
  let stage: "identity_restore" | "sdk_approve" = "identity_restore";
  try {
    const authRequestUrl = request.validatedUrlForApproval();
    if (!authRequestUrl) {
      LOGGER.warn("authorize.approval.failed", {
        stage: "request_validation",
        code: "request_unavailable",
      });
      return Result.err({ code: "approval_failed" });
    }
    const restored = await restoreLocalIdentity(pubky, publicKeyZ32);
    if (Result.isError(restored)) {
      LOGGER.warn("authorize.approval.failed", {
        stage: "identity_restore",
        code: restored.error.code,
      });
      return Result.err({ code: "approval_failed" });
    }

    keyHandle = restored.value.keyHandle;
    stage = "sdk_approve";
    if (signal?.aborted) return Result.err({ code: "cancelled" });
    onCommit?.();
    const approved = await pubky.approveAuthRequest(keyHandle, authRequestUrl);
    if (Result.isError(approved)) {
      LOGGER.warn("authorize.approval.failed", {
        stage: "sdk_approve",
        code: approved.error.code,
      });
      return Result.err({ code: "approval_failed" });
    }
    return Result.ok();
  } catch {
    LOGGER.warn("authorize.approval.failed", {
      stage,
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed" });
  } finally {
    disposeIdentityKey(pubky, keyHandle);
    disposePubky(pubky);
  }
}

/** Restores and verifies one named local identity, clearing plaintext key bytes. */
async function restoreLocalIdentity(
  pubky: PubkySdkAdapter,
  publicKeyZ32: string,
): Promise<RestoreLocalIdentityResult> {
  const stored = new LocalStorageIdentityRepository().read(publicKeyZ32);
  if (Result.isError(stored)) return Result.err(stored.error);

  try {
    if (stored.value.identity.publicIdentity.publicKeyZ32 !== publicKeyZ32) {
      LOGGER.warn("identity.local_restore.failed", { code: "identity_mismatch" });
      return Result.err({ code: "identity_mismatch" });
    }

    const restored = await pubky.restoreIdentityKey(stored.value.secretKey);
    if (Result.isError(restored)) {
      return Result.err({ code: "restore_failed", cause: restored.error });
    }

    if (
      !isSamePublicIdentity(restored.value.publicIdentity, stored.value.identity.publicIdentity)
    ) {
      disposeIdentityKey(pubky, restored.value.keyHandle);
      LOGGER.warn("identity.local_restore.failed", { code: "identity_mismatch" });
      return Result.err({ code: "identity_mismatch" });
    }

    return Result.ok(restored.value);
  } finally {
    stored.value.secretKey.bytes.fill(0);
  }
}

function disposeIdentityKey(
  pubky: PubkySdkAdapter,
  keyHandle: PubkyIdentityKey["keyHandle"] | undefined,
): void {
  if (!keyHandle) return;

  try {
    pubky.disposeIdentityKey(keyHandle);
  } catch {
    LOGGER.warn("authorize.cleanup.failed", { operation: "identity_key_dispose" });
  }
}

function disposePubky(pubky: PubkySdkAdapter): void {
  try {
    pubky.dispose();
  } catch {
    LOGGER.warn("authorize.cleanup.failed", { operation: "pubky_dispose" });
  }
}

function isSamePublicIdentity(left: PubkyPublicIdentity, right: PubkyPublicIdentity): boolean {
  return left.publicKeyZ32 === right.publicKeyZ32;
}
