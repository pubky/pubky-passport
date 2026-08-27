import Image from "next/image";
import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type { LocalIdentityResult } from "../../../../logic/local-identity/LocalStorageIdentityRepository";
import { PubkyBrandIcon } from "../../../shared/brand/pubkyBrandIcon";
import { PubkyRingLogo } from "../../../shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "../../../shared/brand/pubkyRingStoreBadges";
import { CheckIcon, ScanIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { PassportNavigation } from "../../../shared/passportNavigation";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";
import { PubkyRingQrCode } from "./pubkyRingQrCode";
import { PubkyRingQrDialog } from "./pubkyRingQrDialog";

function MigrateToPubkyRing({ createMigrationUrl, navigationAction, onBack }: {
  createMigrationUrl: () => LocalIdentityResult<string>;
  navigationAction: "back" | "continue";
  onBack: () => void;
}) {
  const [migrationUrl, setMigrationUrl] = useState<string | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const desktopQrAttemptedRef = useRef(false);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const media = globalThis.matchMedia("(min-width: 48rem)");

    function syncDesktop() {
      setDesktop(media.matches);
      if (media.matches) setQrDialogOpen(false);
      if (!media.matches || desktopQrAttemptedRef.current) return;
      desktopQrAttemptedRef.current = true;
      const result = createMigrationUrl();
      setExportFailed(Result.isError(result));
      if (Result.isOk(result)) setMigrationUrl(result.value);
    }

    syncDesktop();
    media.addEventListener("change", syncDesktop);
    return () => media.removeEventListener("change", syncDesktop);
  }, [createMigrationUrl]);

  function clearMigrationUrl() {
    setQrDialogOpen(false);
  }

  function createUrl(): string | null {
    const result = createMigrationUrl();
    setExportFailed(Result.isError(result));
    return Result.isOk(result) ? result.value : null;
  }

  function showQr() {
    const url = migrationUrl ?? createUrl();
    if (!url) return;

    setMigrationUrl(url);
    setQrDialogOpen(true);
  }

  function importPubky() {
    const url = createUrl();
    if (url) globalThis.location.assign(url);
  }

  function back() {
    setMigrationUrl(null);
    setQrDialogOpen(false);
    onBack();
  }

  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="keychain." aria-label="Migrate to keychain.">Migrate to</DisplayHeading>
      <LeadText>Install a supported keychain app to self-manage your pubky identity.</LeadText>

      <section className="flex w-full flex-col gap-6 rounded-2xl bg-card p-6 md:flex-row md:p-12">
        <div className="flex min-w-0 flex-1 flex-col gap-6 md:justify-center">
          <div className="flex justify-center md:justify-start"><PubkyRingLogo /></div>
          <PubkyRingStoreBadges />
          <p className="hidden text-sm font-medium leading-5 text-muted-foreground md:block">
            Scan this QR with Pubky Ring to import and self-manage your pubky identity.
          </p>

          {exportFailed ? <p className="text-center text-sm text-muted-foreground md:text-left">The active Pubky could not be exported.</p> : null}

          <div className="flex flex-col gap-3 md:hidden">
            <Button onClick={showQr} size="lg" type="button" variant="secondary">
              <ScanIcon />
              Show QR
            </Button>
            <Button onClick={importPubky} size="lg" type="button">
              <PubkyBrandIcon />
              Import pubky
            </Button>
          </div>
        </div>
        {desktop && migrationUrl ? <PubkyRingQrCode className="size-48 shrink-0" value={migrationUrl} /> : null}
      </section>

      <Image
        alt=""
        className="mx-auto size-[200px] md:hidden"
        height={200}
        src="/illustrations/keychain.png"
        unoptimized
        width={200}
      />

      {navigationAction === "back"
        ? <PassportNavigation back={<BackButton onClick={back} />} />
        : <PassportNavigation confirm={<Button className="w-full" onClick={back} size="lg" type="button"><CheckIcon />Continue</Button>} />}
      {qrDialogOpen && migrationUrl ? <PubkyRingQrDialog onClose={clearMigrationUrl} value={migrationUrl} /> : null}
    </PassportScreen>
  );
}

export { MigrateToPubkyRing };
