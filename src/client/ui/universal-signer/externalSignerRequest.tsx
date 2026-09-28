"use client";

import { QRCodeSVG } from "qrcode.react";
import { useId, useState } from "react";

import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { ScanIcon } from "@/client/ui/shared/icons";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";

// Version 40 at error correction M holds at least this many UTF-8 bytes.
const MAXIMUM_QR_BYTES = 2_331;

/**
 * An app's sign-in request and Passport's own profile connection are both `pubkyauth` links for
 * Ring, so each carries its own labels and neither can pass for the other.
 */
const LABELS = {
  "app-request": {
    section: "Sign in with Pubky Ring",
    qrCode: "Pubky authorization QR code",
    link: "Open in Ring",
    tooLarge: "This request is too large for a QR code. Open it directly in Ring on this device.",
    unavailable: "This request is no longer available. Return to the app and start a new request.",
  },
  "profile-connection": {
    section: "Pubky Ring profile connection",
    qrCode: "Pubky Ring profile connection QR code",
    link: "Connect in Ring",
    tooLarge: "This connection request is too large for a QR code. Open it directly in Ring.",
    unavailable: "This connection request is no longer available. Start a new request.",
  },
} as const;

/** Request content only; the caller owns the page shell and request lifecycle. */
export function ExternalSignerRequest({
  getAuthorizationUrl,
  purpose = "app-request",
}: {
  getAuthorizationUrl: () => string | undefined;
  /** An app's request handed to Ring unchanged, or Passport's own profile connection. */
  purpose?: keyof typeof LABELS;
}) {
  const labels = LABELS[purpose];
  const [showMobileQr, setShowMobileQr] = useState(false);
  const id = useId();
  const authorizationUrl = getAuthorizationUrl();
  const canShowQr = Boolean(
    authorizationUrl && new TextEncoder().encode(authorizationUrl).length <= MAXIMUM_QR_BYTES,
  );

  return (
    <section
      aria-label={labels.section}
      className="flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 md:p-8"
    >
      {authorizationUrl ? (
        <>
          {canShowQr ? (
            <div
              className={`${showMobileQr ? "flex" : "hidden md:flex"} justify-center`}
              id={`${id}-qr`}
            >
              <QRCodeSVG
                aria-label={labels.qrCode}
                className="h-auto max-w-full rounded-lg bg-white"
                level="M"
                marginSize={4}
                role="img"
                size={320}
                value={authorizationUrl}
              />
            </div>
          ) : (
            <p className="text-sm leading-5 text-muted-foreground" role="status">
              {labels.tooLarge}
            </p>
          )}
          <div className={`flex flex-col gap-2 ${canShowQr ? "md:hidden" : ""}`}>
            <ButtonLink
              className="w-full"
              href={authorizationUrl}
              referrerPolicy="no-referrer"
              size="lg"
            >
              <PubkyBrandIcon /> {labels.link}
            </ButtonLink>
            {canShowQr ? (
              <Button
                aria-controls={`${id}-qr`}
                aria-expanded={showMobileQr}
                className="w-full"
                onClick={() => setShowMobileQr(!showMobileQr)}
                variant="outline"
              >
                <ScanIcon /> {showMobileQr ? "Hide QR" : "Show QR"}
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <FieldMessage error role="alert">
          {labels.unavailable}
        </FieldMessage>
      )}
    </section>
  );
}
