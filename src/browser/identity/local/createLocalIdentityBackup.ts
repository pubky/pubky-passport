import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import type { LocalIdentityResult, LocalIdentitySummary } from "./localStorageIdentityRepository";

export const MIN_BACKUP_PASSWORD_LENGTH = 12;
const MAX_BACKUP_PASSWORD_LENGTH = 1024;

export type LocalIdentityBackupFile = { bytes: Uint8Array; fileName: string };
export type LocalIdentityBackupErrorCode = "backup_failed" | "identity_unavailable" | "invalid_password";
export type LocalIdentityBackupResult = ResultType<LocalIdentityBackupFile, { code: LocalIdentityBackupErrorCode }>;

type ReadIdentity = (id: string) => LocalIdentityResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }>;

export async function createLocalIdentityBackup(
  readIdentity: ReadIdentity,
  identityId: string,
  password: string,
): Promise<LocalIdentityBackupResult> {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH || password.length > MAX_BACKUP_PASSWORD_LENGTH) {
    return Result.err({ code: "invalid_password" });
  }

  const stored = readIdentity(identityId);
  if (Result.isError(stored)) return Result.err({ code: "identity_unavailable" });

  let pubky: PubkySdkAdapter | undefined;
  try {
    pubky = new PubkySdkAdapter();
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
    pubky?.dispose();
  }
}
