import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import type { PubkyRingMigration, PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
import {
  backupFileName,
  isValidNewBackupPassword,
  verifyBackupFile,
  type BackupVerificationErrorCode,
} from "@/client/logic/backup/BackupVerifier";
import type { LocalIdentityCatalog } from "./localIdentityModels";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityResult,
} from "./LocalStorageIdentityRepository";

export type LocalIdentityRecoveryFile = { bytes: Uint8Array; fileName: string };
type LocalIdentityRecoveryFileErrorCode =
  "recovery_file_failed" | "identity_unavailable" | "invalid_password";
export type LocalIdentityRecoveryFileResult = ResultType<
  LocalIdentityRecoveryFile,
  CodedFailure<LocalIdentityRecoveryFileErrorCode>
>;
export type LocalIdentityBackupCheckResult = ResultType<
  void,
  CodedFailure<BackupVerificationErrorCode | "verification_failed">
>;
type LocalIdentityHomeserverRepublishErrorCode =
  | "homeserver_mismatch"
  | "identity_unavailable"
  | "publication_failed"
  | "resolution_failed"
  | "still_unresolved";
/** Succeeds with the homeserver the `_pubky` record resolves to after publishing. */
export type LocalIdentityHomeserverRepublishResult = ResultType<
  string,
  CodedFailure<LocalIdentityHomeserverRepublishErrorCode>
>;

type LocalIdentityRepositoryPort = Pick<
  LocalStorageIdentityRepository,
  "list" | "select" | "remove" | "subscribe" | "read" | "recordBackup"
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

  /**
   * Re-signs this identity's `_pubky` record and succeeds once it resolves again.
   *
   * A record that still resolves keeps its homeserver. `homeserverPubky` is published only
   * when the lookup definitively finds no record (the SDK cannot republish a missing record
   * without a host), so a failed lookup can never repoint an identity at another homeserver.
   * An identity that remembers the homeserver it was signed up on accepts no other host.
   */
  async republishHomeserver(
    publicKeyZ32: string,
    homeserverPubky: string,
  ): Promise<LocalIdentityHomeserverRepublishResult> {
    const published = await this.publishHomeserverRecord(publicKeyZ32, homeserverPubky);
    if (Result.isError(published)) return published;

    // A fresh client checks the network, not the cache the publishing client just filled.
    const resolved = await this.resolveHomeserver(publicKeyZ32);
    if (Result.isError(resolved)) {
      return Result.err({ code: "still_unresolved", cause: resolved.error });
    }
    return resolved.value === null
      ? Result.err({ code: "still_unresolved" })
      : Result.ok(resolved.value);
  }

  private async publishHomeserverRecord(
    publicKeyZ32: string,
    homeserverPubky: string,
  ): Promise<ResultType<void, CodedFailure<LocalIdentityHomeserverRepublishErrorCode>>> {
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      const registered = stored.value.identity.homeserverPubky;
      if (registered !== undefined && registered !== homeserverPubky) {
        return Result.err({ code: "homeserver_mismatch" });
      }
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const current = await pubky.resolveHomeserver(publicKeyZ32);
      if (Result.isError(current)) {
        return Result.err({ code: "resolution_failed", cause: current.error });
      }
      const restored = await pubky.restoreIdentityKey(stored.value.secretKey);
      if (Result.isError(restored)) {
        return Result.err({ code: "publication_failed", cause: restored.error });
      }
      if (restored.value.publicIdentity.publicKeyZ32 !== publicKeyZ32) {
        return Result.err({ code: "publication_failed" });
      }
      // Without a host the SDK re-signs the homeserver already in the record.
      const published = await pubky.publishHomeserver(
        restored.value.keyHandle,
        current.value === null ? homeserverPubky : null,
      );
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
    // One rule for every new backup, whether created at signup or from management.
    if (!isValidNewBackupPassword(password)) return Result.err({ code: "invalid_password" });

    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const recoveryFile = pubky.createRecoveryFile(stored.value.secretKey, publicKeyZ32, password);
      if (Result.isError(recoveryFile)) {
        return Result.err({ code: "recovery_file_failed", cause: recoveryFile.error });
      }
      // Recorded as made, not as a backup: the browser may still cancel the download, so only a
      // file that later opens with its password counts as protecting the key.
      this.recordBackup(publicKeyZ32, "created");
      return Result.ok({
        bytes: recoveryFile.value,
        fileName: backupFileName(publicKeyZ32),
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

  /**
   * Opens a backup file of this identity with its password, without signing in or storing its
   * key, and records the success so every screen can say the backup was checked. The bytes are
   * always cleared.
   */
  async verifyRecoveryFile(
    publicKeyZ32: string,
    recoveryFile: Uint8Array,
    password: string,
  ): Promise<LocalIdentityBackupCheckResult> {
    const verified = await verifyBackupFile(recoveryFile, password, publicKeyZ32);
    if (Result.isOk(verified)) this.recordBackup(publicKeyZ32, "verified");
    return verified;
  }

  /** The backup status is advisory: failing to record it never fails the backup itself. */
  private recordBackup(publicKeyZ32: string, event: "created" | "verified"): void {
    const recorded = this.repository.recordBackup(publicKeyZ32, event, new Date());
    if (Result.isError(recorded)) {
      LOGGER.warn("identity.controller.failed", {
        operation: "record_backup",
        code: recorded.error.code,
      });
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
