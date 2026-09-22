import Image from "next/image";
import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { PubkyRingLogo } from "@/client/ui/shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "@/client/ui/shared/brand/pubkyRingStoreBadges";
import { CheckIcon, ScanIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { PubkyRingQrCode } from "./pubkyRingQrCode";
import { PubkyRingQrDialog } from "./pubkyRingQrDialog";

type MigrationMode = "desktop" | "dialog";

type PubkyRingMigrationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; mode: MigrationMode; migration: PubkyRingMigration }
  | { status: "failed" };

const IDLE_MIGRATION_STATE: PubkyRingMigrationState = { status: "idle" };

function MigrateToPubkyRing({
  createMigration,
  navigationAction,
  onBack,
}: {
  createMigration: () => Promise<LocalIdentityResult<PubkyRingMigration>>;
  navigationAction: "back" | "continue";
  onBack: () => void;
}) {
  const [state, setState] = useState<PubkyRingMigrationState>(IDLE_MIGRATION_STATE);
  // Ownership lives outside React state on purpose: `ownedMigrationRef` lets every transition
  // dispose the previous secret-bearing handle synchronously (a reducer or effect cleanup would
  // double-run or free a handle a Strict Mode remount still renders), `requestRef` cancels
  // event-handler-initiated loads that settle after invalidation, and `createMigrationRef`
  // keeps a changed `createMigration` prop from regenerating a ready QR on parent re-renders.
  const requestRef = useRef(0);
  const ownedMigrationRef = useRef<PubkyRingMigration | undefined>(undefined);
  const createMigrationRef = useRef(createMigration);

  useEffect(() => {
    createMigrationRef.current = createMigration;
  }, [createMigration]);

  /** Disposes the previously owned handle, then commits the next view state. */
  const commitOwned = useCallback((next: PubkyRingMigrationState) => {
    ownedMigrationRef.current?.dispose();
    ownedMigrationRef.current = next.status === "ready" ? next.migration : undefined;
    setState(next);
  }, []);

  const invalidate = useCallback(() => {
    requestRef.current += 1;
    commitOwned(IDLE_MIGRATION_STATE);
  }, [commitOwned]);

  /** Creates a migration for the current request; a stale or failed request yields null. */
  const requestMigration = useCallback(async (): Promise<PubkyRingMigration | null> => {
    const request = ++requestRef.current;
    commitOwned({ status: "loading" });
    const result = await createMigrationRef.current();
    if (request !== requestRef.current) {
      if (Result.isOk(result)) result.value.dispose();
      return null;
    }
    if (Result.isError(result)) {
      commitOwned({ status: "failed" });
      return null;
    }
    return result.value;
  }, [commitOwned]);

  const load = useCallback(
    async (mode: MigrationMode) => {
      const migration = await requestMigration();
      if (migration) commitOwned({ status: "ready", mode, migration });
    },
    [commitOwned, requestMigration],
  );

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return invalidate;
    const media = globalThis.matchMedia("(min-width: 48rem)");

    async function syncDesktop() {
      invalidate();
      if (media.matches) await load("desktop");
    }

    void syncDesktop();
    const onChange = () => {
      void syncDesktop();
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
      invalidate();
    };
  }, [invalidate, load]);

  async function importPubky() {
    const migration = ownedMigrationRef.current ?? (await requestMigration());
    if (!migration) return;
    // Own a freshly created handle so the invalidation below disposes it even if navigate throws.
    ownedMigrationRef.current = migration;
    try {
      migration.navigate();
    } finally {
      invalidate();
    }
  }

  function back() {
    invalidate();
    onBack();
  }

  const pending = state.status === "loading";
  const exportFailed = state.status === "failed";

  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="keychain." aria-label="Migrate to keychain.">
          Migrate to
        </DisplayHeading>
        <LeadText>Install a supported keychain app to self-manage your pubky identity.</LeadText>
      </div>

      <section className="flex w-full flex-col gap-6 rounded-2xl bg-card p-6 md:flex-row md:p-12">
        <div className="flex min-w-0 flex-1 flex-col gap-6 md:justify-center">
          <div className="flex justify-center md:justify-start">
            <PubkyRingLogo />
          </div>
          <PubkyRingStoreBadges />
          <p className="hidden text-sm font-medium leading-5 text-muted-foreground md:block">
            Scan this QR with Pubky Ring to import and self-manage your pubky identity.
          </p>

          {exportFailed ? (
            <p className="text-center text-sm text-muted-foreground md:text-left">
              The active Pubky could not be exported.
            </p>
          ) : null}

          <div className="flex flex-col gap-3 md:hidden">
            <Button
              disabled={pending}
              onClick={() => {
                void load("dialog");
              }}
              size="lg"
              type="button"
              variant="secondary"
            >
              <ScanIcon />
              Show QR
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                void importPubky();
              }}
              size="lg"
              type="button"
            >
              <PubkyBrandIcon />
              Import pubky
            </Button>
          </div>
        </div>
        {state.status === "ready" && state.mode === "desktop" ? (
          <PubkyRingQrCode className="size-48 shrink-0" migration={state.migration} />
        ) : null}
      </section>

      <Image
        alt=""
        className="mx-auto size-50 md:hidden"
        height={200}
        src="/illustrations/keychain.png"
        width={200}
      />

      {navigationAction === "back" ? (
        <PassportNavigation back={<BackButton onClick={back} />} />
      ) : (
        <PassportNavigation
          confirm={
            <Button className="w-full" onClick={back} size="lg" type="button">
              <CheckIcon />
              Continue
            </Button>
          }
        />
      )}
      {state.status === "ready" && state.mode === "dialog" ? (
        <PubkyRingQrDialog migration={state.migration} onClose={invalidate} />
      ) : null}
    </PassportScreen>
  );
}

export { MigrateToPubkyRing };
