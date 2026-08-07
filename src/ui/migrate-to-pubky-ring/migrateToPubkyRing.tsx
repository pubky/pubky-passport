"use client";

import { Result } from "better-result";
import { useState } from "react";

import type { PassportIdentityController } from "../../browser/identity/passportIdentity";
import { PubkyBrandIcon } from "../shared/brand/pubkyBrandIcon";
import { PubkyRingLogo } from "../shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "../shared/brand/pubkyRingStoreBadges";
import { ScanIcon } from "../shared/icons/actionIcons";
import { BackButton } from "../shared/navigation/backButton";
import { Button } from "../shared/primitives/button";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";
import { PubkyRingKeychainIllustration } from "./pubkyRingKeychainIllustration";
import { PubkyRingQrDialog } from "./pubkyRingQrDialog";

function MigrateToPubkyRing({ createMigrationUrl, onBack }: {
  createMigrationUrl: PassportIdentityController["createActivePubkyRingMigrationUrl"];
  onBack: () => void;
}) {
  const [migration] = useState(createMigrationUrl);
  const [showQr, setShowQr] = useState(false);
  const migrationUrl = Result.isError(migration) ? null : migration.value;

  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-6 px-6 pb-6 pt-3">
      <DisplayHeading accent="keychain." aria-label="Migrate to keychain.">Migrate to</DisplayHeading>
      <LeadText>Install a supported keychain app to self-manage your pubky identity.</LeadText>

      <section className="flex w-full flex-col gap-6 rounded-md bg-card p-6">
        <div className="flex justify-center"><PubkyRingLogo /></div>
        <PubkyRingStoreBadges />

        {!migrationUrl ? <p className="text-center text-sm text-muted-foreground">The active Pubky could not be exported.</p> : null}

        <div className="flex flex-col gap-3">
          <Button disabled={!migrationUrl} onClick={() => setShowQr(true)} size="lg" type="button" variant="secondary">
            <ScanIcon />
            Show QR
          </Button>
          <Button asChild size="lg">
            <a aria-disabled={!migrationUrl} href={migrationUrl ?? undefined} onClick={(event) => { if (!migrationUrl) event.preventDefault(); }}>
              <PubkyBrandIcon />
              Import pubky
            </a>
          </Button>
        </div>
      </section>

      <PubkyRingKeychainIllustration />

      <div className="mt-auto pt-4"><BackButton onClick={onBack} /></div>
      {migrationUrl ? <PubkyRingQrDialog onClose={() => setShowQr(false)} open={showQr} value={migrationUrl} /> : null}
    </main>
  );
}

export { MigrateToPubkyRing };
