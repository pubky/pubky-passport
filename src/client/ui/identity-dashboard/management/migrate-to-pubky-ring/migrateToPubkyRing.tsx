"use client";

import Image from "next/image";
import { useState } from "react";

import { PubkyBrandIcon } from "../../../shared/brand/pubkyBrandIcon";
import { PubkyRingLogo } from "../../../shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "../../../shared/brand/pubkyRingStoreBadges";
import { ScanIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button, ButtonLink } from "../../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";
import { PubkyRingQrDialog } from "./pubkyRingQrDialog";

function MigrateToPubkyRing({ migrationUrl, onBack }: {
  migrationUrl: string | null;
  onBack: () => void;
}) {
  const [showQr, setShowQr] = useState(false);

  return (
    <PassportScreen className="gap-6">
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
          <ButtonLink aria-disabled={!migrationUrl} href={migrationUrl ?? undefined} onClick={(event) => { if (!migrationUrl) event.preventDefault(); }} size="lg">
            <PubkyBrandIcon />
            Import pubky
          </ButtonLink>
        </div>
      </section>

      <Image
        alt=""
        className="mx-auto size-[200px]"
        data-slot="pubky-ring-keychain-illustration"
        height={200}
        src="/illustrations/pubky-ring-keychain.png"
        unoptimized
        width={200}
      />

      <div className="mt-auto pt-4"><BackButton onClick={onBack} /></div>
      {migrationUrl ? <PubkyRingQrDialog onClose={() => setShowQr(false)} open={showQr} value={migrationUrl} /> : null}
    </PassportScreen>
  );
}

export { MigrateToPubkyRing };
