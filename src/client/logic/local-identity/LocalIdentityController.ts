import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import type { PubkyRingMigration, PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
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
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const restored = await pubky.restoreIdentityKey(stored.value.secretKey);
      if (Result.isError(restored)) {
        return Result.err({ code: "publication_failed", cause: restored.error });
      }
      if (restored.value.publicIdentity.publicKeyZ32 !== publicKeyZ32) {
        return Result.err({ code: "publication_failed" });
      }
      const published = await pubky.publishHomeserver(restored.value.keyHandle);
      return Result.isError(published)
        ? Result.err({ code: "publication_failed", cause: published.error })
        : Result.ok();
    } catch (e) {
      LOGGER.warn("identity.controller.failed", {
        operation: "republish_homeserver",
        code: "publication_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "publication_failed", cause: e });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch (e) {
        LOGGER.warn("identity.homeserver.republish.cleanup.failed", {
          operation: "pubky_dispose",
          ...safeErrorLogFields(e),
        });
      }
    }
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
}
