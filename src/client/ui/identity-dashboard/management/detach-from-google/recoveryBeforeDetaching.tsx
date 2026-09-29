import type { ReactNode } from "react";

import type { KeyBackupFile } from "@/client/logic/local-identity/keyBackup";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { ArrowRightIcon, DownloadIcon, ScanIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { LeadText } from "@/client/ui/shared/primitives/typography";
import { ONLY_COPY_WORD } from "./confirmGoogleDetachment";

/**
 * Detaching deletes the Google Drive backup, often the only copy of the key outside this browser,
 * so this screen offers the other backups first. A recovery file of this key checked here, or
 * checked or imported earlier (named with its date, as on logging out), lets the detachment go on
 * as it is. Without one, the way on stays open but says what it asks for: the confirmation then
 * takes a typed acknowledgement that this browser will keep the key's only copy.
 */
function RecoveryBeforeDetaching({
  backupChecked,
  onBack,
  onRecoveryConfirmed,
  onDownloadRecoveryFile,
  onMigrateToKeychain,
  recordedBackup,
}: {
  /** A recovery file of this key opened with its password during this detachment. */
  backupChecked: boolean;
  /** The recovery file this browser recorded for the key before; a checked or imported one counts. */
  recordedBackup: KeyBackupFile | undefined;
  onBack: () => void;
  onRecoveryConfirmed: () => void;
  onDownloadRecoveryFile: () => void;
  onMigrateToKeychain: () => void;
}) {
  return (
    <PassportScreen className="gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <h1
          aria-label="Back up your pubky first."
          className="text-5xl font-bold leading-none outline-none md:text-6xl"
          tabIndex={-1}
        >
          <span className="block md:inline">Back up your </span>
          <span className="text-brand">pubky</span>
          <br className="hidden md:block" /> first.
        </h1>
        <LeadText>
          Detaching deletes your Google Drive backup. Keep another backup, so you can restore this
          pubky if this browser loses it.
        </LeadText>
        <OnboardingCard illustration="/illustrations/backup-shield.png" className="mt-3">
          <h2 className="text-xl font-bold leading-7">Choose backup method</h2>
          <RecoveryMethodButton icon={<ScanIcon />} onClick={onMigrateToKeychain}>
            Use in Pubky Ring
          </RecoveryMethodButton>
          <RecoveryMethodButton icon={<DownloadIcon />} onClick={onDownloadRecoveryFile}>
            Download recovery file
          </RecoveryMethodButton>
        </OnboardingCard>
        {backupChecked ? (
          <Notice className="md:mt-3" tone="info">
            Your recovery file opened with its password. Keep the file and its password somewhere
            safe.
          </Notice>
        ) : recordedBackup?.verified ? (
          <Notice className="md:mt-3" tone="info">
            You checked a recovery file of this key on {formatBackupDate(recordedBackup.at)}. Make
            sure you still have the file and its password.
          </Notice>
        ) : (
          // Pubky Ring cannot report an import, and a file made elsewhere is out of sight.
          <Notice className="md:mt-3" tone="warning">
            No recovery file of this key has been checked. You can still detach, but you’ll type{" "}
            {ONLY_COPY_WORD} to confirm that this browser keeps the only copy of your key.
          </Notice>
        )}
      </div>

      <PassportNavigation
        back={<BackButton onClick={onBack} />}
        className="mt-auto md:mt-0"
        confirm={
          <Button className="w-full" onClick={onRecoveryConfirmed} size="lg" type="button">
            <ArrowRightIcon />
            Continue to detach
          </Button>
        }
      />
    </PassportScreen>
  );
}

function RecoveryMethodButton({
  children,
  icon,
  onClick,
}: {
  children: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button className="w-full" onClick={onClick} size="lg" type="button" variant="secondary">
      {icon}
      {children}
    </Button>
  );
}

export { RecoveryBeforeDetaching };
