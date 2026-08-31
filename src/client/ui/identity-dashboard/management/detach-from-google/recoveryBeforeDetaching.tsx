import type { ReactNode } from "react";

import { CheckIcon, DownloadIcon, KeyRoundIcon } from "../../../shared/icons";
import { BackButton } from "../../../shared/backButton";
import { PassportNavigation } from "../../../shared/passportNavigation";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { LeadText } from "../../../shared/primitives/typography";

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
        <section className="flex flex-col gap-3 pt-6 md:mt-5 md:pt-0">
          <p className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
            Choose backup method
          </p>
          <RecoveryMethodButton icon={<KeyRoundIcon />} onClick={onMigrateToKeychain}>
            Migrate to keychain
          </RecoveryMethodButton>
          <RecoveryMethodButton icon={<DownloadIcon />} onClick={onDownloadRecoveryFile}>
            Download encrypted backup
          </RecoveryMethodButton>
        </section>
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
