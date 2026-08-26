import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import type { CodedFailure } from "../../../../libs/result";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityErrorCode,
} from "../../local-identity/LocalStorageIdentityRepository";
import type {
  PubkyIdentityKey,
  PubkyPublicIdentity,
} from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/PubkySdkAdapter";
import type { IssuedPubkyAuthRequest } from "../request/IssuedPubkyAuthRequest";

type ApproveAuthorizationResult = ResultType<
  void,
  CodedFailure<"approval_failed">
>;

type RestoreLocalIdentityResult = ResultType<
  PubkyIdentityKey,
  CodedFailure<RestoreLocalIdentityErrorCode>
>;

type RestoreLocalIdentityErrorCode =
  | LocalIdentityErrorCode
  | "identity_mismatch"
  | "restore_failed";

/** Approves one request with the exact local identity selected during review. */
export async function approveAuthorization(
  request: IssuedPubkyAuthRequest,
  publicKeyZ32: string,
): Promise<ApproveAuthorizationResult> {
  let pubky: PubkySdkAdapter;
  try {
    pubky = new PubkySdkAdapter();
  } catch (error) {
    LOGGER.warn("authorize.approval.failed", {
      stage: "sdk_initialize",
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed", cause: error });
  }

  let keyHandle: PubkyIdentityKey["keyHandle"] | undefined;
  let stage: "identity_restore" | "sdk_approve" = "identity_restore";
  try {
    const restored = await restoreLocalIdentity(pubky, publicKeyZ32);
    if (Result.isError(restored)) {
      return Result.err({ code: "approval_failed", cause: restored.error });
    }

    keyHandle = restored.value.keyHandle;
    stage = "sdk_approve";
    const approved = await pubky.approveAuthRequest(keyHandle, request);
    return Result.isError(approved)
      ? Result.err({ code: "approval_failed", cause: approved.error })
      : Result.ok();
  } catch (error) {
    LOGGER.warn("authorize.approval.failed", {
      stage,
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed", cause: error });
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

    if (!isSamePublicIdentity(restored.value.publicIdentity, stored.value.identity.publicIdentity)) {
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
