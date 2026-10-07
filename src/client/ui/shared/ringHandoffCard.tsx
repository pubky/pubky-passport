"use client";

import Image from "next/image";
import type { ReactNode } from "react";

import { PubkyRingStoreBadges } from "./brand/pubkyRingStoreBadges";
import { cn } from "./mergeClassNames";
import { useRingHandoffAlignment } from "./ringHandoffScreen";

/** Pubky Ring's scan illustration, as the start page's Pubky Ring card shows it. */
export const RING_ILLUSTRATION = "/illustrations/scan.png";

/**
 * The card every Pubky Ring hand-off shows its code or button in (an app's sign-in, a signup,
 * Passport's profile connection, its backup check, a key export), so all of them look the same:
 * the hand-off (`children`) and, under it, where to get Pubky Ring. On a screen of its own the card
 * spans the track and, from lg, centres Pubky Ring's scan illustration and the hand-off with the
 * store badges side by side in it, as pubky.app's QR frame does. Inside a card that already names
 * Pubky Ring and shows the illustration (the start page's, the one on Verify your backup) it adds
 * no surface of its own, and both start on that card's text edge.
 */
export function RingHandoffCard({ children, label }: { children: ReactNode; label: string }) {
  const start = useRingHandoffAlignment() === "start";
  const column = (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-4",
        start ? "items-start" : "items-center lg:w-auto",
      )}
    >
      {children}
      {/* The badges alone; the question stays for screen readers. */}
      <div
        className={cn("flex flex-col gap-2", start ? "items-start" : "items-center")}
        data-slot="ring-install"
      >
        <p className="sr-only">Don&apos;t have Pubky Ring?</p>
        <PubkyRingStoreBadges align={start ? "start" : "center"} />
      </div>
    </div>
  );
  if (start)
    return (
      <section aria-label={label} className="flex w-full min-w-0 flex-col">
        {column}
      </section>
    );
  return (
    <section
      aria-label={label}
      className="flex w-full min-w-0 gap-6 rounded-md bg-card p-6 md:p-8 lg:items-center lg:justify-center lg:gap-12 lg:p-12 [@media(max-height:50rem)]:py-4"
    >
      <Image
        alt=""
        aria-hidden="true"
        className="hidden size-36 shrink-0 object-contain lg:block lg:size-48"
        height={192}
        src={RING_ILLUSTRATION}
        width={192}
      />
      {column}
    </section>
  );
}
