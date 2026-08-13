import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LocalStorageIdentityRepository } from "./localStorageIdentityRepository";

export const MIN_BACKUP_PASSWORD_LENGTH = 6;
const MAX_BACKUP_PASSWORD_LENGTH = 1024;

export type LocalIdentityBackupFile = { bytes: Uint8Array; fileName: string };
export type LocalIdentityBackupErrorCode = "backup_failed" | "identity_unavailable" | "invalid_password";
export type LocalIdentityBackupResult = ResultType<LocalIdentityBackupFile, { code: LocalIdentityBackupErrorCode }>;
type CreatePubkySdkAdapter = () => Pick<PubkySdkAdapter, "createRecoveryFile" | "dispose">;

/** Creates a password-encrypted recovery file from one locally stored identity. */
export class CreateLocalIdentityBackup {
  constructor(
    private readonly readIdentity: LocalStorageIdentityRepository["read"],
    private readonly createPubky: CreatePubkySdkAdapter = () => new PubkySdkAdapter(),
  ) {}

  async create(identityId: string, password: string): Promise<LocalIdentityBackupResult> {
    if (password.length < MIN_BACKUP_PASSWORD_LENGTH || password.length > MAX_BACKUP_PASSWORD_LENGTH) {
      return Result.err({ code: "invalid_password" });
    }

    const stored = this.readIdentity(identityId);
    if (Result.isError(stored)) return Result.err({ code: "identity_unavailable" });

    let pubky: ReturnType<CreatePubkySdkAdapter> | undefined;
    try {
      pubky = this.createPubky();
      const recoveryFile = pubky.createRecoveryFile(stored.value.secretKey, password);
      if (Result.isError(recoveryFile)) return Result.err({ code: "backup_failed" });
      return Result.ok({
        bytes: recoveryFile.value,
        fileName: `pubky-${identityId}.pkarr`,
      });
    } catch {
      return Result.err({ code: "backup_failed" });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch {
        LOGGER.warn("identity.local_backup.cleanup.failed", { operation: "pubky_dispose" });
      }
    }
  }
}
