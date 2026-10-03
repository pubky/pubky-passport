import Image from "next/image";
import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import type { MethodAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { Notice } from "@/client/ui/shared/notice";
import { Button } from "@/client/ui/shared/primitives/button";

export function AvailabilityCard({
  blocked,
  label,
  className,
  children,
}: {
  blocked: boolean;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const warningId = useId();
  return (
    <div
      className="relative min-w-0"
      role="group"
      aria-label={label}
      aria-describedby={blocked ? warningId : undefined}
    >
      <div
        className={`${className} lg:h-full ${blocked ? "pointer-events-none opacity-50 lg:blur-[2.5px]" : ""}`}
      >
        {children}
      </div>
      {blocked ? (
        <>
          {/* Below lg the cards collapse to their buttons, so the warning is a row under this
              method that names it. It only describes the card; AvailabilityNotice announces the
              blocked methods once for the whole list. */}
          <p
            className="mt-2 flex items-center gap-2 text-sm font-medium leading-5 text-foreground lg:hidden"
            id={warningId}
          >
            <AlertIcon />
            {label}: not available in your country
          </p>
          {/* From lg the card shows its title, and the warning covers the card. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden items-center justify-center px-6 lg:flex"
          >
            <p className="flex items-center gap-3 rounded-md bg-destructive/60 px-4 py-3 text-sm font-bold text-destructive-foreground">
              <AlertIcon />
              Not available in your country
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AlertIcon() {
  return (
    <Image
      alt=""
      src="/icons/triangle-alert.svg"
      width={16}
      height={16}
      className="size-4 shrink-0"
    />
  );
}

/**
 * Whether a check has come back blocked or failed at least once. From then on its note and its
 * Check again stay mounted through the re-check, so focus is not lost.
 */
export function useRetryOffered(statuses: readonly MethodAvailability["status"][]): boolean {
  const [offered, setOffered] = useState(false);
  const failing = statuses.some((status) => status === "unknown" || status === "blocked");
  if (failing && !offered) setOffered(true);
  return offered || failing;
}

export function AvailabilityNotice({
  methods,
  onRetry,
  blockedSummary,
  quietCheck = false,
  retry = true,
}: {
  methods: MethodAvailability[];
  onRetry: () => void;
  /**
   * Announces a running check without showing it, where the methods' own buttons show it: a
   * line that appears and goes on every visit would move everything under it.
   */
  quietCheck?: boolean;
  /**
   * False where another note beside this one already offers Check again: one press re-checks
   * every method, so the button is not repeated.
   */
  retry?: boolean;
  /**
   * Names every blocked method and what is left (see {@link describeBlockedMethods}), empty while
   * nothing is blocked. It is the one announcement of a block; the cards' warnings stay silent.
   */
  blockedSummary?: string | undefined;
}) {
  const checking = methods.some((method) => method.status === "checking");
  const unknown = methods.some((method) => method.status === "unknown");
  // Once offered, the retry button stays mounted and focusable through the re-check, showing it
  // as the work in progress, so focus is not lost.
  const retryOffered = useRetryOffered(methods.map((method) => method.status));
  return (
    <>
      {blockedSummary === undefined ? null : (
        // Mounted while the methods are still checked, so the summary is announced when it fills.
        <p className="sr-only" role="status">
          {blockedSummary}
        </p>
      )}
      {checking ? (
        <p role="status" className={quietCheck ? "sr-only" : "text-sm text-muted-foreground"}>
          Checking available verification methods…
        </p>
      ) : null}
      {unknown ? (
        <p role="status" className="text-sm text-muted-foreground">
          Couldn’t check all verification methods. You can try again or use an invite code.
        </p>
      ) : null}
      {retryOffered && retry ? (
        <Button className="self-start" variant="secondary" onClick={onRetry} loading={checking}>
          Check again
        </Button>
      ) : null}
    </>
  );
}

/**
 * Whether new Google sign-ups work here, said inside the Google option it concerns. Restoring a
 * pubky never depends on it, so each note says so. Nothing shows while the first check runs or when
 * it finds sign-ups available. A blocked or failed check puts Check again in its note; during the
 * re-check the button stays mounted and focusable, showing the work. A re-check that finds
 * sign-ups available says so in the same note, and the note takes the focus Check again leaves
 * with, so the result is read out and Tab goes on to the Google sign-in after it.
 */
export function GoogleSignupAvailability({
  availability,
  onRetry,
}: {
  availability: MethodAvailability;
  onRetry: () => void;
}) {
  const noteId = useId();
  const { status } = availability;
  const retryOffered = useRetryOffered([status]);
  const availableAfterRetry = retryOffered && status === "available";
  useLayoutEffect(() => {
    if (!availableAfterRetry) return;
    // Take focus only from the removed Check again; focus the person moved elsewhere stays put.
    const focused = document.activeElement;
    if (focused === null || focused === document.body) document.getElementById(noteId)?.focus();
  }, [availableAfterRetry, noteId]);
  if (!retryOffered) return null;
  const checkAgain = (
    <Button loading={status === "checking"} onClick={onRetry} size="sm" variant="outline">
      Check again
    </Button>
  );
  switch (status) {
    case "blocked":
      return (
        <Notice tone="warning">
          <p>
            New Google sign-ups aren’t available in your country. You can still restore a pubky you
            created with Google.
          </p>
          {checkAgain}
        </Notice>
      );
    case "unknown":
      return (
        <Notice tone="info">
          <p>
            Couldn’t check whether new Google sign-ups work where you are. You can still try, and
            restoring a pubky you created with Google always works.
          </p>
          {checkAgain}
        </Notice>
      );
    case "checking":
      return (
        <Notice tone="info">
          <p>Checking whether new Google sign-ups are available…</p>
          {checkAgain}
        </Notice>
      );
    case "available":
      return (
        <Notice id={noteId} tabIndex={-1} tone="info">
          <p>New Google sign-ups are available here.</p>
        </Notice>
      );
    case "unavailable":
      return null;
  }
}

/**
 * One sentence for {@link AvailabilityNotice}: "SMS isn’t available in your country. You can use
 * Lightning or an invite code." Empty when nothing is blocked.
 */
export function describeBlockedMethods(
  blocked: readonly string[],
  usable: readonly string[],
): string {
  if (blocked.length === 0) return "";
  const names = new Intl.ListFormat("en-US", { type: "conjunction" }).format(blocked);
  const sentence = `${names} ${blocked.length === 1 ? "isn’t" : "aren’t"} available in your country.`;
  if (usable.length === 0) return sentence;
  const alternatives = new Intl.ListFormat("en-US", { type: "disjunction" }).format(usable);
  return `${sentence} You can use ${alternatives}.`;
}
