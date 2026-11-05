import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import type { PubkyIdentityKeyHandle } from "@/client/logic/pubky/pubkyIdentityKey";
import type {
  PubkyAuthorizedApp,
  PubkyRingMigration,
  PubkySdkAdapter,
} from "@/client/logic/pubky/PubkySdkAdapter";
import type { LocalIdentityCatalog } from "./localIdentityModels";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityResult,
} from "./LocalStorageIdentityRepository";

export const MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 6;
const MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 1024;

export type LocalIdentityRecoveryFile = { bytes: Uint8Array; fileName: string };
type LocalIdentityRecoveryFileErrorCode =
  "recovery_file_failed" | "identity_unavailable" | "invalid_password";
export type LocalIdentityRecoveryFileResult = ResultType<
  LocalIdentityRecoveryFile,
  CodedFailure<LocalIdentityRecoveryFileErrorCode>
>;
type LocalIdentityHomeserverRepublishErrorCode = "publication_failed" | "identity_unavailable";
export type LocalIdentityHomeserverRepublishResult = ResultType<
  void,
  CodedFailure<LocalIdentityHomeserverRepublishErrorCode>
>;

type LocalIdentityAuthorizedAppsErrorCode = "authorized_apps_unavailable" | "identity_unavailable";
export type LocalIdentityAuthorizedAppsResult = ResultType<
  readonly PubkyAuthorizedApp[],
  CodedFailure<LocalIdentityAuthorizedAppsErrorCode>
>;
type LocalIdentityAuthorizedAppRevocationErrorCode = "identity_unavailable" | "revocation_failed";
export type LocalIdentityAuthorizedAppRevocationResult = ResultType<
  void,
  CodedFailure<LocalIdentityAuthorizedAppRevocationErrorCode>
>;

type LocalIdentityRepositoryPort = Pick<
  LocalStorageIdentityRepository,
  "list" | "select" | "remove" | "subscribe" | "read"
>;

/**
 * Browser entry point for identities stored in localStorage.
 *
 * Optional `repository` replaces {@link LocalStorageIdentityRepository}.
 * Production omits it.
 */
export class LocalIdentityController {
  private readonly repository: LocalIdentityRepositoryPort;

  constructor(repository?: LocalIdentityRepositoryPort) {
    this.repository = repository ?? new LocalStorageIdentityRepository();
  }

  listIdentities(): LocalIdentityResult<LocalIdentityCatalog> {
    return this.repository.list();
  }

  selectIdentity(publicKeyZ32: string): LocalIdentityResult<void> {
    return this.repository.select(publicKeyZ32);
  }

  removeIdentity(publicKeyZ32: string): LocalIdentityResult<void> {
    return this.repository.remove(publicKeyZ32);
  }

  subscribeToIdentityChanges(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  async resolveHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult> {
    try {
      const { resolvePubkyHomeserver } = await import("@/client/logic/pubky/PubkySdkAdapter");
      return await resolvePubkyHomeserver(publicKeyZ32);
    } catch (e) {
      return Result.err({ code: "resolution_failed", cause: e });
    }
  }

  async republishHomeserver(publicKeyZ32: string): Promise<LocalIdentityHomeserverRepublishResult> {
    return this.withRestoredIdentity(
      publicKeyZ32,
      "republish_homeserver",
      "publication_failed",
      (pubky, keyHandle) => pubky.publishHomeserver(keyHandle),
    );
  }

  async listAuthorizedApps(publicKeyZ32: string): Promise<LocalIdentityAuthorizedAppsResult> {
    return this.withRestoredIdentity(
      publicKeyZ32,
      "list_authorized_apps",
      "authorized_apps_unavailable",
      (pubky, keyHandle) => pubky.listAuthorizedApps(keyHandle),
    );
  }

  async revokeAuthorizedApp(
    publicKeyZ32: string,
    grantId: string,
  ): Promise<LocalIdentityAuthorizedAppRevocationResult> {
    return this.withRestoredIdentity(
      publicKeyZ32,
      "revoke_authorized_app",
      "revocation_failed",
      (pubky, keyHandle) => pubky.revokeAuthorizedApp(keyHandle, grantId),
    );
  }

  async createRecoveryFile(
    publicKeyZ32: string,
    password: string,
  ): Promise<LocalIdentityRecoveryFileResult> {
    if (
      password.length < MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS ||
      password.length > MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS
    ) {
      return Result.err({ code: "invalid_password" });
    }

    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const recoveryFile = pubky.createRecoveryFile(stored.value.secretKey, publicKeyZ32, password);
      return Result.isError(recoveryFile)
        ? Result.err({ code: "recovery_file_failed", cause: recoveryFile.error })
        : Result.ok({
            bytes: recoveryFile.value,
            fileName: `pubky-${publicKeyZ32}.pkarr`,
          });
    } catch (e) {
      LOGGER.warn("identity.controller.failed", {
        operation: "create_recovery_file",
        code: "recovery_file_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "recovery_file_failed", cause: e });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch (e) {
        LOGGER.warn("identity.recovery_file.cleanup.failed", {
          operation: "pubky_dispose",
          ...safeErrorLogFields(e),
        });
      }
    }
  }

  async createPubkyRingMigration(
    publicKeyZ32: string,
  ): Promise<LocalIdentityResult<PubkyRingMigration>> {
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) return Result.err(stored.error);

    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      const migration = PubkySdkAdapter.createPubkyRingMigration(
        stored.value.secretKey,
        publicKeyZ32,
      );
      return Result.isOk(migration)
        ? Result.ok(migration.value)
        : Result.err({ code: "invalid_secret_key", cause: migration.error });
    } catch (e) {
      return Result.err({ code: "invalid_secret_key", cause: e });
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }

  /**
   * Restores the stored key into a short-lived SDK adapter for one operation, then clears the key
   * bytes and disposes the adapter. Every failure after the identity is read maps to `failureCode`.
   */
  private async withRestoredIdentity<Success, FailureCode extends string>(
    publicKeyZ32: string,
    operation: "list_authorized_apps" | "republish_homeserver" | "revoke_authorized_app",
    failureCode: FailureCode,
    action: (
      pubky: PubkySdkAdapter,
      keyHandle: PubkyIdentityKeyHandle,
    ) => Promise<ResultType<Success, CodedFailure<string>>>,
  ): Promise<ResultType<Success, CodedFailure<FailureCode | "identity_unavailable">>> {
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const restored = pubky.restoreIdentityKey(stored.value.secretKey);
      if (Result.isError(restored)) {
        return Result.err({ code: failureCode, cause: restored.error });
      }
      if (restored.value.publicIdentity.publicKeyZ32 !== publicKeyZ32) {
        return Result.err({ code: failureCode });
      }
      const result = await action(pubky, restored.value.keyHandle);
      return Result.isError(result)
        ? Result.err({ code: failureCode, cause: result.error })
        : Result.ok(result.value);
    } catch (e) {
      LOGGER.warn("identity.controller.failed", {
        operation,
        code: failureCode,
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: failureCode, cause: e });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch (e) {
        LOGGER.warn("identity.controller.cleanup.failed", {
          operation,
          stage: "pubky_dispose",
          ...safeErrorLogFields(e),
        });
      }
    }
  }
}
