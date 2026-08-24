"use client";

import Image from "next/image";
import { useState } from "react";

import { PubkyBrandIcon } from "../../../shared/brand/pubkyBrandIcon";
import { PubkyRingLogo } from "../../../shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "../../../shared/brand/pubkyRingStoreBadges";
import { ScanIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";
import { PubkyRingQrDialog } from "./pubkyRingQrDialog";

function MigrateToPubkyRing({ createMigrationUrl, onBack }: {
  createMigrationUrl: () => string | null;
  onBack: () => void;
}) {
  const [migrationUrl, setMigrationUrl] = useState<string | null>(null);
  const [exportFailed, setExportFailed] = useState(false);

  function clearMigrationUrl() {
    setMigrationUrl(null);
  }

  function createUrl(): string | null {
    const url = createMigrationUrl();
    setExportFailed(url === null);
    return url;
  }

  function showQr() {
    const url = createUrl();
    if (!url) return;

    setMigrationUrl(url);
  }

  function importPubky() {
    const url = createUrl();
    if (url) globalThis.location.assign(url);
  }

  function back() {
    clearMigrationUrl();
    onBack();
  }

  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="keychain." aria-label="Migrate to keychain.">Migrate to</DisplayHeading>
      <LeadText>Install a supported keychain app to self-manage your pubky identity.</LeadText>

      <section className="flex w-full flex-col gap-6 rounded-md bg-card p-6">
        <div className="flex justify-center"><PubkyRingLogo /></div>
        <PubkyRingStoreBadges />

        {exportFailed ? <p className="text-center text-sm text-muted-foreground">The active Pubky could not be exported.</p> : null}

        <div className="flex flex-col gap-3">
          <Button onClick={showQr} size="lg" type="button" variant="secondary">
            <ScanIcon />
            Show QR
          </Button>
          <Button onClick={importPubky} size="lg" type="button">
            <PubkyBrandIcon />
            Import pubky
          </Button>
        </div>
      </section>

      <Image
        alt=""
        className="mx-auto size-[200px]"
        data-slot="pubky-ring-keychain-illustration"
        height={200}
        src="/illustrations/pubky-ring-keychain-source.png"
        unoptimized
        width={200}
      />

      <div className="mt-auto pt-4"><BackButton onClick={back} /></div>
      {migrationUrl ? <PubkyRingQrDialog onClose={clearMigrationUrl} value={migrationUrl} /> : null}
    </PassportScreen>
  );
}

export { MigrateToPubkyRing };
