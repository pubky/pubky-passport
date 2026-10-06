"use client";

import { cn } from "@/client/ui/shared/mergeClassNames";
import { usePendingRequest } from "@/client/ui/shared/usePendingRequest";

const LINK_CLASS_NAME =
  "rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";

/**
 * While a request waits, the legal pages open in a new tab: reading the terms before approving
 * must not navigate the app's popup away and drop its request. Once it has its answer, they open
 * in the tab again.
 */
function LegalLinks({ className }: { className?: string }) {
  const request = usePendingRequest();
  const target = request ? ({ rel: "noopener noreferrer", target: "_blank" } as const) : {};
  const newTab = request ? (
    <>
      {" "}
      <span className="sr-only">(opens in a new tab)</span>
    </>
  ) : null;
  return (
    <nav aria-label="Legal" className={cn("flex items-center gap-4", className)}>
      <a className={LINK_CLASS_NAME} href="/terms-of-service" {...target}>
        Terms of Service
        {newTab}
      </a>
      <a className={LINK_CLASS_NAME} href="/privacy-policy" {...target}>
        Privacy Policy
        {newTab}
      </a>
    </nav>
  );
}

export { LegalLinks };
