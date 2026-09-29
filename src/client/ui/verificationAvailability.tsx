import Image from "next/image";
import { useId, useState, type ReactNode } from "react";
import type { MethodAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
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

export function AvailabilityNotice({
  methods,
  onRetry,
  blockedSummary,
}: {
  methods: MethodAvailability[];
  onRetry: () => void;
  /**
   * Names every blocked method and what is left (see {@link describeBlockedMethods}), empty while
   * nothing is blocked. It is the one announcement of a block; the cards' warnings stay silent.
   */
  blockedSummary?: string | undefined;
}) {
  const checking = methods.some((method) => method.status === "checking");
  const unknown = methods.some((method) => method.status === "unknown");
  const blocked = methods.some((method) => method.status === "blocked");
  // Once offered, the retry button stays mounted and focusable through the re-check, showing it
  // as the work in progress, so focus is not lost.
  const [retryOffered, setRetryOffered] = useState(false);
  if ((unknown || blocked) && !retryOffered) setRetryOffered(true);
  return (
    <>
      {blockedSummary === undefined ? null : (
        // Mounted while the methods are still checked, so the summary is announced when it fills.
        <p className="sr-only" role="status">
          {blockedSummary}
        </p>
      )}
      {checking ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking available verification methods…
        </p>
      ) : null}
      {unknown ? (
        <p role="status" className="text-sm text-muted-foreground">
          Couldn’t check all verification methods. You can try again or use an invite code.
        </p>
      ) : null}
      {retryOffered ? (
        <Button className="self-start" variant="secondary" onClick={onRetry} loading={checking}>
          Check again
        </Button>
      ) : null}
    </>
  );
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
