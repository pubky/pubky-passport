import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { PubkyRingLogo } from "@/client/ui/shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "@/client/ui/shared/brand/pubkyRingStoreBadges";
import { CheckIcon, ScanIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { PubkyRingQrCode } from "./pubkyRingQrCode";
import { PubkyRingQrDialog } from "./pubkyRingQrDialog";

type MigrationMode = "desktop" | "dialog";

const DESKTOP_QUERY = "(min-width: 48rem)";

/** The QR code is the private key: anyone who sees it holds the identity. */
const QR_WARNING =
  "This code contains your private key. Anyone who scans it can use your pubky. Don’t show it on a shared or recorded screen.";

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
  const pending = state.status === "loading";
  // Both buttons wait on the same export; only the one pressed shows it.
  const [pressed, setPressed] = useState<"qr" | "import" | null>(null);
  if (pressed && !pending) setPressed(null);
  // Ownership lives outside React state on purpose: `ownedMigrationRef` lets every transition
  // dispose the previous secret-bearing handle synchronously (a reducer or effect cleanup would
  // double-run or free a handle a Strict Mode remount still renders), `requestRef` cancels
  // event-handler-initiated loads that settle after invalidation, and `createMigrationRef`
  // keeps a changed `createMigration` prop from regenerating a ready QR on parent re-renders.
  const requestRef = useRef(0);
  const statusRef = useRef<PubkyRingMigrationState["status"]>("idle");
  const ownedMigrationRef = useRef<PubkyRingMigration | undefined>(undefined);
  const createMigrationRef = useRef(createMigration);

  useEffect(() => {
    createMigrationRef.current = createMigration;
  }, [createMigration]);

  /** Disposes the previously owned handle, then commits the next view state. */
  const commitOwned = useCallback((next: PubkyRingMigrationState) => {
    ownedMigrationRef.current?.dispose();
    ownedMigrationRef.current = next.status === "ready" ? next.migration : undefined;
    statusRef.current = next.status;
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

  // The pointer decides whether this device can open Ring, not the width: a computer (fine
  // pointer) cannot, so it gets only the QR code; a phone can also open this pubky in Ring.
  const mode = useRingHandoffMode();
  // The QR code appears only when asked for, and goes away when the layout switches between the
  // inline code and the drawer or the page is hidden (another tab, a minimised window). A failure
  // message stays until the next attempt.
  useEffect(() => {
    const withdraw = () => {
      if (statusRef.current !== "failed") invalidate();
    };
    const hide = () => {
      if (document.hidden) withdraw();
    };
    const media =
      typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(DESKTOP_QUERY) : null;
    document.addEventListener("visibilitychange", hide);
    media?.addEventListener("change", withdraw);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      media?.removeEventListener("change", withdraw);
      invalidate();
    };
  }, [invalidate]);

  function showQr() {
    const desktop =
      typeof globalThis.matchMedia === "function" && globalThis.matchMedia(DESKTOP_QUERY).matches;
    setPressed("qr");
    void load(desktop ? "desktop" : "dialog");
  }

  // A phone still showing this page shortly after Open in Pubky Ring did not open Ring: show the
  // QR code.
  const [, launcher] = useDeepLinkLauncher();
  useEffect(
    () =>
      launcher?.subscribe(() => {
        if (launcher.getState() === "failed") void load("dialog");
      }),
    [launcher, load],
  );

  async function importPubky() {
    const migration = ownedMigrationRef.current ?? (await requestMigration());
    if (!migration) return;
    // Own a freshly created handle so the invalidation below disposes it even if navigate throws.
    ownedMigrationRef.current = migration;
    try {
      launcher?.launch(() => {
        if (!migration.navigate()) throw new Error("Migration link unavailable.");
      });
    } finally {
      invalidate();
    }
  }

  function back() {
    invalidate();
    onBack();
  }

  const exportFailed = state.status === "failed";
  const desktopQr = state.status === "ready" && state.mode === "desktop";

  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="Pubky Ring." aria-label="Use in Pubky Ring.">
          Use in
        </DisplayHeading>
        <LeadText>
          Pubky Ring is a phone app that keeps your key. Scan a code with Ring, or open this pubky
          in Ring on your phone, to add it there.
        </LeadText>
      </div>

      <section className="flex w-full flex-col gap-6 rounded-lg bg-card p-6 md:flex-row md:p-8">
        <div className="flex min-w-0 flex-1 flex-col gap-6 md:justify-center">
          <div className="flex justify-center md:justify-start">
            <PubkyRingLogo />
          </div>
          <PubkyRingStoreBadges />
          <Notice tone="warning">{QR_WARNING}</Notice>
          {exportFailed ? (
            <Notice focusOnMount tone="error">
              Passport couldn’t read this key from browser storage. Try again, or download an
              encrypted backup instead.
            </Notice>
          ) : null}

          <div className="flex flex-col gap-3 md:flex-row">
            <Button
              disabled={pending && pressed !== "qr"}
              loading={pending && pressed === "qr"}
              onClick={desktopQr ? invalidate : showQr}
              size="lg"
              type="button"
              variant="secondary"
            >
              <ScanIcon />
              {desktopQr ? "Hide QR code" : "Show QR code"}
            </Button>
            {mode === "open" ? (
              <Button
                disabled={pending && pressed !== "import"}
                loading={pending && pressed === "import"}
                onClick={() => {
                  setPressed("import");
                  void importPubky();
                }}
                size="lg"
                type="button"
              >
                <PubkyBrandIcon />
                Open in Pubky Ring
              </Button>
            ) : null}
          </div>
          <p className="text-sm leading-5 text-muted-foreground">
            Once Ring has it, your key is in both places. To keep it only in Ring, remove it from
            this browser afterwards.
          </p>
        </div>
        {desktopQr ? (
          <PubkyRingQrCode className="size-48 shrink-0" migration={state.migration} />
        ) : (
          <div className="hidden size-48 shrink-0 flex-col items-center justify-center gap-2 self-center rounded-lg border border-dashed border-border p-4 text-center text-xs leading-4 text-muted-foreground md:flex">
            <ScanIcon />
            The QR code stays hidden until you choose Show QR code.
          </div>
        )}
      </section>

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
        <PubkyRingQrDialog migration={state.migration} onClose={invalidate} warning={QR_WARNING} />
      ) : null}
    </PassportScreen>
  );
}

export { MigrateToPubkyRing };
