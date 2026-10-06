"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";

import { copyToClipboard, type CopyToasts } from "./copyToClipboard";
import { cn } from "./mergeClassNames";
import { Spinner } from "./primitives/spinner";

/** The code inside its 192px tile; the tile's padding is the code's quiet zone. */
const QR_SIZE = 176;
/** Pubky Ring's mark covers the centre: 48 of the code's 176 units, as on pubky.app. */
const LOGO_SIZE = 48;
/** Version 40 at error correction H, the level the covered centre needs, holds this many bytes. */
export const RING_QR_MAXIMUM_BYTES = 1_273;

const LINK_COPY_TOASTS = {
  copied: "Authentication link copied",
  failed: "Could not copy to clipboard",
  failedDescription: "Scan the code with Pubky Ring instead.",
} as const satisfies CopyToasts;

/** Whether `url` fits a code Pubky Ring can scan; a longer link can only be opened. */
export function fitsRingQrCode(url: string): boolean {
  return new TextEncoder().encode(url).length <= RING_QR_MAXIMUM_BYTES;
}

/**
 * Every QR code Passport shows for Pubky Ring, as pubky.app shows its own: a light tile, the code
 * at error correction H, and Pubky Ring's mark over its centre. Three states: being prepared (a
 * spinner in the tile, which keeps its size so nothing moves when the code arrives), ready, and
 * expired (a dark, blurred stand-in with a "Click to reload" tag; pressing it asks for a new code).
 *
 * Pressing a ready code copies the link it encodes, said with a toast and never logged; the code
 * fades only while it is pressed. The press
 * target is a button laid over the code rather than around it, so the code keeps its own name for
 * assistive technology. `copyLink={false}` is for a code whose link must not reach the clipboard:
 * the key export's, which is the private key itself.
 */
export function RingQrCode({
  className,
  copyLink = true,
  expired,
  label,
  url,
}: {
  className?: string | undefined;
  copyLink?: boolean;
  /** The link ran out: the code is blurred and pressing it calls `onReload`. */
  expired?: { onReload: () => void } | undefined;
  /** Names the code, e.g. "Pubky authorization QR code". */
  label: string;
  /** The link the code encodes; absent while it is being prepared. */
  url: string | undefined;
}) {
  const tile = cn(
    "group relative flex size-48 shrink-0 items-center justify-center rounded-md bg-foreground p-2",
    className,
  );
  if (expired) {
    return (
      <div className={tile} data-state="expired">
        {/* A stand-in pattern: the expired link is not drawn, blurred or not. Inset and dark, as
            pubky.app shows its own. */}
        <QRCodeSVG
          aria-hidden="true"
          bgColor="transparent"
          className="block size-full p-2 blur-[3px] transition-opacity group-active:opacity-80"
          fgColor="#05050a"
          level="H"
          marginSize={0}
          size={QR_SIZE}
          value="pubky-passport:expired"
        />
        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 whitespace-nowrap bg-card py-2 pl-7 pr-4 text-sm font-bold text-foreground [clip-path:polygon(0%_0%,100%_0%,100%_100%,16px_100%)]">
          Click to reload
        </span>
        <button
          aria-label="Reload sign-in QR code"
          className="absolute inset-0 cursor-pointer rounded-md"
          onClick={expired.onReload}
          type="button"
        />
      </div>
    );
  }
  // Only a press shows, never a hover: the code and the Ring logo fade while pressed, then are
  // fully dark again.
  const dim = copyLink ? "transition-opacity group-active:opacity-80" : undefined;
  if (!url) {
    return (
      <div className={tile} data-state="generating">
        <p className="flex flex-col items-center gap-2 text-sm text-background" role="status">
          <Spinner className="size-8" decorative />
          Generating QR code…
        </p>
      </div>
    );
  }
  return (
    <div className={tile} data-state="ready">
      <QRCodeSVG
        aria-label={label}
        bgColor="transparent"
        className={cn("block size-full", dim)}
        fgColor="#05050a"
        level="H"
        marginSize={0}
        role="img"
        size={QR_SIZE}
        value={url}
      />
      <Image
        alt=""
        aria-hidden="true"
        // 48 of the code's 176 units, whatever the tile's size: the tile's padding is not code.
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 h-auto w-[calc((100%-1rem)*0.2727)] -translate-x-1/2 -translate-y-1/2",
          dim,
        )}
        height={LOGO_SIZE}
        src="/brand/ring-logo.svg"
        unoptimized
        width={LOGO_SIZE}
      />
      {copyLink ? (
        <button
          aria-label="Copy authentication link"
          className="absolute inset-0 cursor-pointer rounded-md"
          onClick={() => void copyToClipboard(url, LINK_COPY_TOASTS)}
          type="button"
        />
      ) : null}
    </div>
  );
}
