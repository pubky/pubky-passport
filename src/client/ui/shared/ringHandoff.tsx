"use client";

import { useEffect, useRef } from "react";

import type { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { PubkyBrandIcon } from "./brand/pubkyBrandIcon";
import { RotateCcwIcon } from "./icons";
import { Notice } from "./notice";
import { Button, ButtonLink } from "./primitives/button";
import { Spinner } from "./primitives/spinner";
import { RingHandoffCard } from "./ringHandoffCard";
import { useRingHandoffAlignment } from "./ringHandoffScreen";
import { fitsRingQrCode, RingQrCode } from "./ringQrCode";
import { useDeepLinkLauncher, useRingHandoffMode } from "./useRingHandoff";

export type RingHandoffLabels = {
  /** Names the card, e.g. "Sign in with Pubky Ring". */
  section: string;
  qrCode: string;
  /** The action that follows the deep link, e.g. "Open Pubky Ring". */
  open: string;
  tooLarge: string;
  unavailable: string;
};

/** While the link is being opened, whatever the action is called otherwise. */
const OPENING = "Opening Pubky Ring…";

/**
 * Hands `url`, a Pubky Ring deep link, over by pointer, in the card every hand-off shares
 * (`RingHandoffCard`, with the store badges under it). A fine pointer (a computer) gets the QR code
 * at once and no link, which a computer cannot open. A coarse pointer (a phone) gets one button and
 * never a code, which a phone cannot scan from its own screen: the button follows the link
 * ("Opening Pubky Ring…" while it does) and stays in place to open Ring again with the same
 * request. Nothing on a phone changes when Ring opens or when the page comes back into view, so
 * nothing flashes while the link fires.
 *
 * `openOnReady` is for a hand-off the person started with a press before its link existed (a card
 * whose own button prepares the request): the link is followed once, as soon as it exists, while
 * the browser still counts that press; otherwise the button waits for the next press. Until the
 * link exists the phone's button holds its place, busy, so nothing moves when it arrives; a
 * computer shows the code's tile at its final size. `spent` is a request that can no longer be
 * used (it expired or failed; the caller says why in a toast): in the same place a computer shows
 * the blurred "Click to reload" tile and a phone a Try again button, and either starts a new one.
 * The caller owns the page shell and the link's lifecycle; `launcher` carries a launch that started
 * before this card, e.g. from the button that opened the screen.
 */
export function RingHandoff({
  labels,
  launcher: sharedLauncher,
  openOnReady = false,
  preparing = false,
  spent,
  url,
}: {
  labels: RingHandoffLabels;
  launcher?: DeepLinkLauncher | undefined;
  /** The person's press started this hand-off: follow the link once, as soon as it exists. */
  openOnReady?: boolean;
  /**
   * The link is still being made. A computer shows the code's tile at its final size meanwhile;
   * a phone shows its button, busy, in the place it will keep.
   */
  preparing?: boolean;
  /** The request can no longer be used; `onRetry` starts a new one. */
  spent?: { onRetry: () => void } | undefined;
  url: string | undefined;
}) {
  // Inside a card that names Pubky Ring, the phone's button is that card's own, pressed: it keeps
  // that button's look.
  const variant = useRingHandoffAlignment() === "start" ? "secondary" : "default";
  const mode = useRingHandoffMode();
  const [launch, launcher] = useDeepLinkLauncher(sharedLauncher);
  const link = preparing || spent ? undefined : url;
  const phone = mode === "open";

  // Followed once per link, and only while the press that asked for it still counts: a browser
  // hands a link to an app only from the person's own action.
  const opened = useRef<string>(undefined);
  useEffect(() => {
    if (!openOnReady || !phone || !link || !launcher || opened.current === link) return;
    opened.current = link;
    if (launcher.getState() !== "idle" || !pressStillCounts()) return;
    launcher.launch(link);
  }, [launcher, link, openOnReady, phone]);

  const openButton = (busy: boolean) => (
    <ButtonLink
      aria-busy={busy || undefined}
      className="w-full"
      href={link!}
      onClick={() => launcher?.watch()}
      referrerPolicy="no-referrer"
      size="lg"
      variant={variant}
    >
      {busy ? <Spinner decorative /> : <PubkyBrandIcon />}
      {busy ? OPENING : labels.open}
    </ButtonLink>
  );

  let handoff;
  if (spent)
    handoff = phone ? (
      <Button className="w-full" onClick={spent.onRetry} size="lg" variant={variant}>
        <RotateCcwIcon />
        Try again
      </Button>
    ) : (
      // The spent code stays in place, blurred, and is itself the way to a new one.
      <RingQrCode expired={{ onReload: spent.onRetry }} label={labels.qrCode} url={undefined} />
    );
  else if (preparing)
    handoff = phone ? (
      // The button's place while the link is made, so it stays where the person pressed.
      <Button aria-busy className="w-full" disabled size="lg" variant={variant}>
        <Spinner decorative />
        {openOnReady ? OPENING : labels.open}
      </Button>
    ) : (
      <RingQrCode label={labels.qrCode} url={undefined} />
    );
  else if (!link)
    handoff = (
      <Notice className="w-full" tone="error">
        {labels.unavailable}
      </Notice>
    );
  else if (phone) handoff = openButton(launch === "opening");
  else if (fitsRingQrCode(link))
    // Pressing the code copies this same link, for Pubky Ring on this device.
    handoff = <RingQrCode label={labels.qrCode} url={link} />;
  else
    // Too long for a code: it can only be opened, on a device where Ring is installed.
    handoff = (
      <>
        <Notice className="w-full" tone="warning">
          {labels.tooLarge}
        </Notice>
        {openButton(launch === "opening")}
      </>
    );

  return <RingHandoffCard label={labels.section}>{handoff}</RingHandoffCard>;
}

/**
 * Whether the person's last press still counts as theirs, so following a link now would be
 * theirs too; a browser that cannot tell is trusted to.
 */
function pressStillCounts(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation === undefined || activation.isActive;
}
