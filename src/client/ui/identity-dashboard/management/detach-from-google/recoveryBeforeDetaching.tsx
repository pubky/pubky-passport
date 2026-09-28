import type { ReactNode } from "react";

import { CheckIcon, DownloadIcon, ScanIcon } from "@/client/ui/shared/icons";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { LeadText } from "@/client/ui/shared/primitives/typography";

function RecoveryBeforeDetaching({
  onBack,
  onRecoveryConfirmed,
  onDownloadRecoveryFile,
  onMigrateToKeychain,
}: {
  onBack: () => void;
  onRecoveryConfirmed: () => void;
  onDownloadRecoveryFile: () => void;
  onMigrateToKeychain: () => void;
}) {
  return (
    <PassportScreen className="gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <h1
          aria-label="Backup your pubky first."
          className="text-5xl font-bold leading-none md:text-6xl"
        >
          <span className="block md:inline">Backup your </span>
          <span className="text-brand">pubky</span>
          <br className="hidden md:block" /> first.
        </h1>
        <LeadText>
          If you remove Google as a way to access your pubky identity, you need a backup to restore
          account access.
        </LeadText>
        <OnboardingCard illustration="/illustrations/backup-shield.png" className="mt-3">
          <h2 className="text-xl font-bold leading-7">Choose backup method</h2>
          <p className="text-base leading-6 text-secondary-foreground">
            Safely back up your pubky before disconnecting Google.
          </p>
          <RecoveryMethodButton icon={<ScanIcon />} onClick={onMigrateToKeychain}>
            Migrate to keychain
          </RecoveryMethodButton>
          <RecoveryMethodButton icon={<DownloadIcon />} onClick={onDownloadRecoveryFile}>
            Download encrypted backup
          </RecoveryMethodButton>
        </OnboardingCard>
      </div>

      <PassportNavigation
        back={<BackButton onClick={onBack} />}
        className="mt-auto md:mt-0"
        confirm={
          <Button className="w-full" onClick={onRecoveryConfirmed} size="lg" type="button">
            <CheckIcon />I backed up my pubky
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
