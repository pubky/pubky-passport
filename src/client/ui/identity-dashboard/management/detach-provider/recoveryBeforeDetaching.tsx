import type { ReactNode } from "react";

import { CheckIcon, DownloadIcon, KeyRoundIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { LeadText } from "@/client/ui/shared/primitives/typography";

function RecoveryBeforeDetaching({
  providerName,
  onBack,
  onRecoveryConfirmed,
  onDownloadRecoveryFile,
  onMigrateToKeychain,
}: {
  /** Sign-in provider being removed, for example "Google". */
  providerName: string;
  onBack: () => void;
  onRecoveryConfirmed: () => void;
  onDownloadRecoveryFile: () => void;
  onMigrateToKeychain: () => void;
}) {
  return (
    <PassportScreen className="gap-8">
      <div className="flex flex-col gap-6">
        <h1 aria-label="Backup your pubky first." className="text-5xl font-bold leading-none">
          <span className="block">Backup your </span>
          <span className="text-brand">pubky</span> first.
        </h1>
        <LeadText>
          If you remove {providerName} as a way to access your pubky identity, you need a backup to
          restore account access.
        </LeadText>
        <section className="flex flex-col gap-3 pt-6">
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
        className="mt-auto"
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
