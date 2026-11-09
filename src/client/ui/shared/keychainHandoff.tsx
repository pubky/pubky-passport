import Image from "next/image";
import { type ReactNode, useId } from "react";

import { KeychainLogos } from "./brand/keychainBrands";
import { useRingHandoffMode } from "./useRingHandoff";

/**
 * What to do in the keychain app with a code, in the QR frames' words (45785-544486 Pubky Ring,
 * 45785-544529 Bitkit), unified as one list for both apps (decision 2).
 */
export const KEYCHAIN_QR_STEPS = [
  "Open Pubky Ring or Bitkit",
  "Tap ‘Scan’",
  "Scan this QR",
  "Authorize in the app",
] as const;

/** The QR frames' heading and lead, unified for both apps. */
export const KEYCHAIN_QR_TITLE = "Scan QR with keychain.";
export const KEYCHAIN_QR_LEAD = "Use Pubky Ring or Bitkit and follow the instructions below.";

/**
 * The card of a hand-off that either keychain app can take (Pubky Ring or Bitkit read the same
 * `pubkyauth` link), as pubky.app draws it (frame 45785-544486): a computer gets the scan
 * illustration, the code with what belongs under it (`footer`, such as the classic QR switch), and
 * beside them an optional heading and lead over a short numbered list of what to do in the app; the
 * card is as tall as that row. A phone gets both apps' logos over the one button that opens the
 * link. `handoff` is the code or the button (a bare `RingHandoff`).
 */
export function KeychainHandoffCard({
  footer,
  handoff,
  instructions,
  label,
  lead,
  title,
}: {
  footer?: ReactNode;
  handoff: ReactNode;
  /** What to do in the keychain app after scanning, in order; a computer shows them. */
  instructions: readonly string[];
  /** The card's name for assistive technology when it has no visible `title`. */
  label: string;
  lead?: string;
  title?: string;
}) {
  const scanning = useRingHandoffMode() === "scan";
  const titleId = useId();
  const named = title
    ? ({ "aria-labelledby": titleId } as const)
    : ({ "aria-label": label } as const);
  const heading = title ? (
    <div className="flex flex-col gap-1">
      <h2 className="text-2xl font-bold leading-8" id={titleId}>
        {title}
      </h2>
      {lead ? <p className="text-base leading-6 text-muted-foreground">{lead}</p> : null}
    </div>
  ) : null;
  if (!scanning)
    return (
      <section
        {...named}
        className="flex min-w-0 flex-col items-center gap-6 rounded-lg bg-card p-6 md:p-12"
      >
        {heading}
        <KeychainLogos align="center" />
        <div className="flex w-full max-w-sm flex-col gap-4">{handoff}</div>
        {footer ? <div className="w-full max-w-sm">{footer}</div> : null}
      </section>
    );
  return (
    <section
      {...named}
      className="flex min-w-0 flex-col items-center gap-8 rounded-lg bg-card p-6 md:flex-row md:justify-center md:gap-12 md:p-12"
    >
      <Image
        alt=""
        aria-hidden="true"
        className="hidden size-48 shrink-0 object-contain lg:block"
        height={192}
        src="/illustrations/scan.png"
        width={192}
      />
      {/* The switch sits right under the code it changes. */}
      <div className="flex shrink-0 flex-col items-center gap-3">
        {handoff}
        {footer}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {heading}
        <ol className="list-decimal space-y-1 pl-6 text-base leading-6 text-secondary-foreground">
          {instructions.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
