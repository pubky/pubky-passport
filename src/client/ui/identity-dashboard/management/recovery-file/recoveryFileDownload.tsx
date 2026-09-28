import type { LocalIdentityRecoveryFileResult } from "@/client/logic/local-identity/LocalIdentityController";
import { BackupFlow } from "@/client/ui/backup/backupFlow";

export function RecoveryFileDownload({
  createRecoveryFile,
  publicKeyZ32,
  onBack,
}: {
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  publicKeyZ32: string;
  onBack: () => void;
}) {
  return (
    <BackupFlow
      publicKey={publicKeyZ32}
      createBackup={(password) => createRecoveryFile(publicKeyZ32, password)}
      onBack={onBack}
      onComplete={onBack}
    />
  );
}
