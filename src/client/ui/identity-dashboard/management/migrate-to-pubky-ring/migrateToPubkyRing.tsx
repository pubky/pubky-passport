import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { ArrowRightIcon, CheckIcon, ScanIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { RingHandoffCard } from "@/client/ui/shared/ringHandoffCard";
import { RingHandoffScreen, RingHandoffStatus } from "@/client/ui/shared/ringHandoffScreen";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { PubkyRingQrCode } from "./pubkyRingQrCode";
import { PubkyRingQrDialog } from "./pubkyRingQrDialog";

type MigrationMode = "desktop" | "dialog";

const DESKTOP_QUERY = "(min-width: 48rem)";

/** The QR code is the private key: anyone who sees it holds the identity. */
const QR_WARNING =
  "This code contains your private key. Anyone who scans it can use your pubky. Don’t show it on a shared or recorded screen.";
/** On a phone the link is the private key, and only an installed Pubky Ring should receive it. */
const LINK_WARNING =
  "This link contains your private key. Anyone who receives it can use your pubky, so open it only with Pubky Ring already installed on this phone.";

type PubkyRingMigrationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; mode: MigrationMode; migration: PubkyRingMigration }
  | { status: "failed" };

const IDLE_MIGRATION_STATE: PubkyRingMigrationState = { status: "idle" };

/** Said in a toast that stays until read or closed; the card offers the same action again. */
const EXPORT_FAILED =
  "Passport couldn’t read this key from browser storage. Try again, or download a recovery file instead.";
const FAILURE_TOAST_MS = 10_000;

function MigrateToPubkyRing({
  createMigration,
  navigationAction,
  onBack,
  onContinue,
}: {
  createMigration: () => Promise<LocalIdentityResult<PubkyRingMigration>>;
  navigationAction: "back" | "done";
  onBack: () => void;
  /**
   * Goes on to Verify in Pubky Ring, the step after the export: Ring cannot report the import, so
   * the person continues once Ring has the key, and the check there shows it does.
   */
  onContinue?: (() => void) | undefined;
}) {
  const [state, setState] = useState<PubkyRingMigrationState>(IDLE_MIGRATION_STATE);
  const pending = state.status === "loading";
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
      toast.error(EXPORT_FAILED, {
        closeButton: true,
        duration: FAILURE_TOAST_MS,
        id: EXPORT_FAILED,
      });
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
  // pointer) cannot, so it gets only the QR code; a phone only opens this pubky in Ring.
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
    void load(desktop ? "desktop" : "dialog");
  }

  // A phone opens this pubky in Pubky Ring and is never shown the code, which it could not scan
  // from its own screen: Open in Pubky Ring stays for another try, and the store badges below
  // are there for a phone without Ring.
  const [, launcher] = useDeepLinkLauncher();

  async function importPubky() {
    // Only a phone opens this pubky in Ring, and a phone is never shown the code, so each press
    // makes its own export.
    const migration = await requestMigration();
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

  function next() {
    invalidate();
    onContinue?.();
  }

  const continueButton = onContinue ? (
    <Button className="w-full" onClick={next} size="lg" type="button">
      <ArrowRightIcon />
      Continue
    </Button>
  ) : undefined;

  const desktopQr = state.status === "ready" && state.mode === "desktop";
  // A computer only shows the code and a phone only opens Ring, so one control waits at a time.
  const qrLoading = pending;

  return (
    <RingHandoffScreen
      action="Migrate to"
      instruction={
        mode === "open"
          ? "Pubky Ring is a phone app that keeps your key. Open this pubky in Pubky Ring to add it there."
          : "Pubky Ring is a phone app that keeps your key. Scan the code with Pubky Ring on your phone to add it there."
      }
      navigation={
        navigationAction === "back" ? (
          <PassportNavigation back={<BackButton onClick={back} />} confirm={continueButton} />
        ) : (
          // Ring cannot report the import, so this goes on to its check, or only returns to the
          // screen that sent the person.
          <PassportNavigation
            confirm={
              continueButton ?? (
                <Button className="w-full" onClick={back} size="lg" type="button">
                  <CheckIcon />
                  Done
                </Button>
              )
            }
          />
        )
      }
      status={
        <RingHandoffStatus>
          Once Pubky Ring has it, your key is in both places.{" "}
          {onContinue ? "Continue to check that Pubky Ring holds it. " : null}To keep it only in
          Pubky Ring, remove it from this browser afterwards.
        </RingHandoffStatus>
      }
    >
      <RingHandoffCard label="Copy your key to Pubky Ring">
        {mode === "open" ? (
          <>
            <Notice className="w-full max-w-md" tone="warning">
              {LINK_WARNING}
            </Notice>
            <Button
              className="w-full"
              loading={pending}
              onClick={() => {
                void importPubky();
              }}
              size="lg"
              type="button"
            >
              <PubkyBrandIcon />
              Open in Pubky Ring
            </Button>
          </>
        ) : (
          <>
            <Notice className="w-full max-w-md" tone="warning">
              {QR_WARNING}
            </Notice>
            {/* The square is the control: a placeholder until pressed, then the code, which hides
                again when pressed. One button throughout, so focus stays on it; the code is its
                sibling, so it keeps its own name. A phone has none. */}
            <div className="relative size-48 shrink-0">
              {desktopQr ? (
                <PubkyRingQrCode className="size-full" migration={state.migration} />
              ) : null}
              <button
                aria-busy={qrLoading || undefined}
                aria-expanded={desktopQr}
                aria-label={desktopQr ? "Hide QR code" : "Show QR code"}
                className={cn(
                  "absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md p-4 text-center text-xs leading-4 text-muted-foreground transition-colors disabled:cursor-default disabled:opacity-50 [&_svg]:size-4",
                  !desktopQr &&
                    "border border-dashed border-border hover:border-foreground/40 hover:text-foreground",
                )}
                onClick={qrLoading ? undefined : desktopQr ? invalidate : showQr}
                type="button"
              >
                {desktopQr ? null : qrLoading ? (
                  <Spinner decorative />
                ) : (
                  <>
                    <ScanIcon />
                    <span aria-hidden="true">
                      <span className="pointer-coarse:hidden">Click</span>
                      <span className="hidden pointer-coarse:inline">Tap</span> to show QR code
                    </span>
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </RingHandoffCard>
      {state.status === "ready" && state.mode === "dialog" ? (
        <PubkyRingQrDialog migration={state.migration} onClose={invalidate} warning={QR_WARNING} />
      ) : null}
    </RingHandoffScreen>
  );
}

export { MigrateToPubkyRing };
