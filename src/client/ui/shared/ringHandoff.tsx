"use client";

import { QRCodeSVG } from "qrcode.react";
import { useId, useState } from "react";

import type { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { PubkyBrandIcon } from "./brand/pubkyBrandIcon";
import { ScanIcon } from "./icons";
import { Notice } from "./notice";
import { Button, ButtonLink } from "./primitives/button";
import { Spinner } from "./primitives/spinner";
import { useDeepLinkLauncher, useRingHandoffMode } from "./useRingHandoff";

// Version 40 at error correction M holds at least this many UTF-8 bytes.
const MAXIMUM_QR_BYTES = 2_331;

export type RingHandoffLabels = {
  /** Names the card, e.g. "Sign in with Pubky Ring". */
  section: string;
  qrCode: string;
  /** The action that follows the deep link, e.g. "Open Pubky Ring". */
  open: string;
  tooLarge: string;
  unavailable: string;
};

/**
 * Hands `url`, a Pubky Ring deep link, over by pointer: on a coarse pointer (a phone) the link is
 * the action, and the QR code appears once the page is still in view about two seconds after
 * following it, because the link did not open Ring; a fine pointer (a computer) gets the QR code
 * at once and no link, which a computer cannot open. A link too long for a QR code can only be
 * opened. The caller owns the page shell and the link's lifecycle; `launcher` carries a launch
 * that started before this card, e.g. from the button that opened the screen.
 */
export function RingHandoff({
  labels,
  launcher: sharedLauncher,
  url,
}: {
  labels: RingHandoffLabels;
  launcher?: DeepLinkLauncher | undefined;
  url: string | undefined;
}) {
  const id = useId();
  const mode = useRingHandoffMode();
  const [launch, launcher] = useDeepLinkLauncher(sharedLauncher);
  const [qrRequested, setQrRequested] = useState(false);
  const canShowQr = Boolean(url && new TextEncoder().encode(url).length <= MAXIMUM_QR_BYTES);
  const didNotOpen = launch === "failed";
  const showQr = canShowQr && (mode === "scan" || qrRequested || didNotOpen);
  const offerOpen = mode === "open" || !canShowQr;

  return (
    <section
      aria-label={labels.section}
      className="flex min-w-0 flex-col items-center gap-6 rounded-lg bg-card p-6 md:p-8 [@media(max-height:50rem)]:py-4"
    >
      {url ? (
        <>
          {showQr ? (
            <div className="flex w-full justify-center" id={`${id}-qr`}>
              <QRCodeSVG
                aria-label={labels.qrCode}
                // Smaller in short windows, so the screen's actions stay in the app's popup.
                className="h-auto w-full max-w-[min(256px,34svh)] rounded-lg bg-white [@media(max-height:50rem)]:max-w-[min(256px,28svh)]"
                level="M"
                marginSize={4}
                role="img"
                size={256}
                value={url}
              />
            </div>
          ) : null}
          {canShowQr ? null : <Notice tone="warning">{labels.tooLarge}</Notice>}
          {/* Stays in the accessibility tree while empty, so the fallback is announced. */}
          <p
            aria-live="polite"
            className={
              didNotOpen ? "w-full text-sm leading-5 text-secondary-foreground" : "sr-only"
            }
          >
            {didNotOpen
              ? canShowQr
                ? "Pubky Ring didn't open on this device. Scan the code with Pubky Ring on another phone, or install Pubky Ring and try again."
                : "Pubky Ring didn't open on this device. Install Pubky Ring and try again."
              : ""}
          </p>
          {offerOpen ? (
            <div className="flex w-full flex-col gap-3">
              <ButtonLink
                aria-busy={launch === "opening" || undefined}
                className="w-full"
                href={url}
                onClick={() => launcher?.watch()}
                referrerPolicy="no-referrer"
                size="lg"
                variant={showQr ? "secondary" : "default"}
              >
                {launch === "opening" ? <Spinner decorative /> : <PubkyBrandIcon />}
                {launch === "opening" ? "Opening Pubky Ring…" : labels.open}
              </ButtonLink>
              {canShowQr && mode === "open" && !didNotOpen ? (
                <Button
                  aria-controls={`${id}-qr`}
                  aria-expanded={qrRequested}
                  className="w-full"
                  onClick={() => setQrRequested(!qrRequested)}
                  size="lg"
                  variant="outline"
                >
                  <ScanIcon /> {qrRequested ? "Hide QR code" : "Show QR code"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <Notice className="w-full" tone="error">
          {labels.unavailable}
        </Notice>
      )}
    </section>
  );
}
