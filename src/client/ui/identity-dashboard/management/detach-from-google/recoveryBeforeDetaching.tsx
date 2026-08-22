import type { ReactNode } from "react";

import { CheckIcon, DownloadIcon, KeyRoundIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { LeadText } from "../../../shared/primitives/typography";

function RecoveryBeforeDetaching({ onBack, onRecoveryConfirmed, onDownloadRecoveryFile, onMigrateToKeychain }: {
  onBack: () => void;
  onRecoveryConfirmed: () => void;
  onDownloadRecoveryFile: () => void;
  onMigrateToKeychain: () => void;
}) {
  return (
    <PassportScreen className="gap-8">
      <div className="flex flex-col gap-6">
        <h1 aria-label="Secure your pubky first." className="text-5xl font-bold leading-none">
          <span className="block">Secure your</span>
          <span className="text-brand">pubky</span> first.
        </h1>
        <LeadText>If you remove Google as a way to access your pubky identity, you need another recovery method.</LeadText>

        <section className="flex flex-col gap-3 rounded-2xl bg-card p-6">
          <p className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">Choose recovery method</p>
          <RecoveryMethodButton icon={<KeyRoundIcon />} onClick={onMigrateToKeychain}>Migrate to keychain</RecoveryMethodButton>
          <RecoveryMethodButton icon={<DownloadIcon />} onClick={onDownloadRecoveryFile}>Download recovery file</RecoveryMethodButton>
        </section>
      </div>

      <div className="mt-auto flex flex-col gap-4">
        <BackButton onClick={onBack} />
        <Button onClick={onRecoveryConfirmed} size="lg" type="button">
          <CheckIcon />
          I secured my pubky
        </Button>
      </div>
    </PassportScreen>
  );
}

function RecoveryMethodButton({ children, icon, onClick }: {
  children: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button className="w-full" onClick={onClick} type="button" variant="secondary">
      {icon}
      {children}
    </Button>
  );
}

export { RecoveryBeforeDetaching };
