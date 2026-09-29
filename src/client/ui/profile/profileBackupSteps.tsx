import { type ReactNode, useState } from "react";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { IdentityCatalogActions } from "@/client/ui/identity-catalog/useIdentityCatalog";
import { RecoveryFileDownload } from "@/client/ui/identity-dashboard/management/recovery-file/recoveryFileDownload";
import { MigrateToPubkyRing } from "@/client/ui/identity-dashboard/management/migrate-to-pubky-ring/migrateToPubkyRing";
import { BackButton } from "@/client/ui/shared/backButton";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { BackupMethods } from "./backupMethods";

/** The backup step of required profile setup, shown before the profile form. */
export function ProfileBackupSteps({
  identity,
  actions,
  onBack,
  onContinue,
  footer,
}: {
  identity: LocalIdentityMetadata;
  actions: IdentityCatalogActions;
  onBack: () => void;
  onContinue: () => void;
  footer?: ReactNode;
}) {
  const publicKey = identity.publicIdentity.publicKeyZ32;
  const [view, setView] = useState<"methods" | "download" | "ring">("methods");
  if (view === "download")
    return (
      <RecoveryFileDownload
        publicKeyZ32={publicKey}
        createRecoveryFile={actions.createRecoveryFile}
        verifyRecoveryFile={actions.verifyRecoveryFile}
        onBack={() => setView("methods")}
      />
    );
  if (view === "ring")
    return (
      <MigrateToPubkyRing
        createMigration={() => actions.createMigration(publicKey)}
        navigationAction="back"
        onBack={() => setView("methods")}
      />
    );
  return (
    <PassportScreen width="wide" className="gap-6">
      <DisplayHeading accent="pubky.">Back up your </DisplayHeading>
      {identity.keySource === "ring" ? (
        <section className="rounded-lg bg-card p-6">
          <h2 className="text-2xl font-bold">Your key is in Ring</h2>
          <p className="mt-3 text-secondary-foreground">
            Manage your backup in Pubky Ring, then continue to your public profile.
          </p>
        </section>
      ) : (
        <BackupMethods onDownload={() => setView("download")} onRing={() => setView("ring")} />
      )}
      <div className="flex flex-col-reverse justify-between gap-3 md:flex-row">
        <BackButton onClick={onBack} />
        <Button size="lg" onClick={onContinue}>
          <ArrowRightIcon /> Continue to profile
        </Button>
      </div>
      {footer}
    </PassportScreen>
  );
}
