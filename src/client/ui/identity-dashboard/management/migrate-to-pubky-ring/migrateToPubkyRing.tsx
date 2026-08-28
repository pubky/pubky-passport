import Image from "next/image";
import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalIdentityResult } from "../../../../logic/local-identity/LocalStorageIdentityRepository";
import { PubkyRingMigration } from "../../../../logic/pubky/PubkySdkAdapter";
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

function MigrateToPubkyRing({ createMigration, navigationAction, onBack }: {
  createMigration: () => LocalIdentityResult<PubkyRingMigration>;
  navigationAction: "back" | "continue";
  onBack: () => void;
}) {
  const migrationRef = useRef<PubkyRingMigration>(null);
  const migrationModeRef = useRef<"desktop" | "dialog" | null>(null);
  const [migration, setMigration] = useState<PubkyRingMigration | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);

  const releaseMigration = useCallback(() => {
    migrationRef.current?.dispose();
    migrationRef.current = null;
    migrationModeRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return releaseMigration;
    const media = globalThis.matchMedia("(min-width: 48rem)");

    function syncDesktop() {
      const nextDesktop = media.matches;
      releaseMigration();
      setMigration(null);
      setDesktop(nextDesktop);
      setQrDialogOpen(false);
      if (!nextDesktop) return;

      const result = createMigration();
      setExportFailed(Result.isError(result));
      if (Result.isError(result)) return;
      migrationRef.current = result.value;
      migrationModeRef.current = "desktop";
      setMigration(result.value);
    }

    syncDesktop();
    media.addEventListener("change", syncDesktop);
    return () => {
      media.removeEventListener("change", syncDesktop);
      releaseMigration();
    };
  }, [createMigration, releaseMigration]);

  function closeQrDialog() {
    if (migrationModeRef.current === "dialog") releaseMigration();
    setMigration(null);
    setQrDialogOpen(false);
  }

  function createOwnedMigration(mode: "dialog"): PubkyRingMigration | null {
    releaseMigration();
    setMigration(null);
    const result = createMigration();
    setExportFailed(Result.isError(result));
    if (Result.isError(result)) return null;
    migrationRef.current = result.value;
    migrationModeRef.current = mode;
    setMigration(result.value);
    return result.value;
  }

  function showQr() {
    if (!createOwnedMigration("dialog")) return;
    setQrDialogOpen(true);
  }

  function importPubky() {
    const result = createMigration();
    setExportFailed(Result.isError(result));
    if (Result.isOk(result)) result.value.navigate();
  }

  function back() {
    releaseMigration();
    setMigration(null);
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
        {desktop && migration ? <PubkyRingQrCode className="size-48 shrink-0" migration={migration} /> : null}
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
      {qrDialogOpen && migration ? <PubkyRingQrDialog migration={migration} onClose={closeQrDialog} /> : null}
    </PassportScreen>
  );
}

export { MigrateToPubkyRing };
