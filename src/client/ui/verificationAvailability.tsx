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
        <div className="pointer-events-none mt-3 flex items-center justify-center lg:absolute lg:inset-0 lg:mt-0 lg:px-6">
          <p
            id={warningId}
            role="status"
            className="flex items-center gap-3 rounded-md bg-destructive/60 px-4 py-3 text-sm font-bold text-destructive-foreground"
          >
            <Image
              alt=""
              src="/icons/triangle-alert.svg"
              width={16}
              height={16}
              className="size-4 shrink-0"
            />
            Not available in your country
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AvailabilityNotice({
  methods,
  onRetry,
}: {
  methods: MethodAvailability[];
  onRetry: () => void;
}) {
  const checking = methods.some((method) => method.status === "checking");
  const unknown = methods.some((method) => method.status === "unknown");
  const blocked = methods.some((method) => method.status === "blocked");
  // Once offered, the retry button stays mounted through the re-check so focus is not lost.
  const [retryOffered, setRetryOffered] = useState(false);
  if ((unknown || blocked) && !retryOffered) setRetryOffered(true);
  return (
    <>
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
        <Button className="self-start" variant="secondary" onClick={onRetry} disabled={checking}>
          Check again
        </Button>
      ) : null}
    </>
  );
}
