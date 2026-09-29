import type {
  LocalIdentityBackupCheckResult,
  LocalIdentityRecoveryFileResult,
} from "@/client/logic/local-identity/LocalIdentityController";
import { BackupFlow } from "@/client/ui/backup/backupFlow";

/**
 * A backup file of a saved identity: download then check it, or with `check` only check one made
 * earlier. Both are recorded on the identity. `allowSkip={false}` makes the check required, for
 * a backup that a removal waits on. `onVerified` hears of a file that opened with its password,
 * before the flow leaves; a skipped check is not one.
 */
export function RecoveryFileDownload({
  allowSkip = true,
  check = false,
  createRecoveryFile,
  verifyRecoveryFile,
  publicKeyZ32,
  onBack,
  onVerified,
}: {
  allowSkip?: boolean;
  check?: boolean;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  verifyRecoveryFile: (
    publicKeyZ32: string,
    recoveryFile: Uint8Array,
    password: string,
  ) => Promise<LocalIdentityBackupCheckResult>;
  publicKeyZ32: string;
  onBack: () => void;
  onVerified?: () => void;
}) {
  return (
    <BackupFlow
      allowSkip={allowSkip}
      checkOnly={check}
      createBackup={(password) => createRecoveryFile(publicKeyZ32, password)}
      verifyBackup={(bytes, password) => verifyRecoveryFile(publicKeyZ32, bytes, password)}
      onBack={onBack}
      onComplete={() => {
        onVerified?.();
        onBack();
      }}
      onSkip={onBack}
    />
  );
}
