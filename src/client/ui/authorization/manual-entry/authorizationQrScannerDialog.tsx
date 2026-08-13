"use client";

import { useEffect, useRef, useState } from "react";

import { ScanIcon, XIcon } from "../../shared/icons/actionIcons";
import { Button } from "../../shared/primitives/button";
import { Dialog } from "../../shared/primitives/dialog";
import { IconButton } from "../../shared/primitives/iconButton";

type AuthorizationQrScannerDialogProps = {
  onClose: () => void;
  onScan: (authorization: string) => void;
};

function AuthorizationQrScannerDialog({ onClose, onScan }: AuthorizationQrScannerDialogProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const videoElement = video.current;
    if (!videoElement) return;

    let disposed = false;
    let scanner: { destroy(): void; start(): Promise<void> } | undefined;

    void import("qr-scanner")
      .then(async ({ default: QrScanner }) => {
        if (disposed) return;
        const hasCamera = await QrScanner.hasCamera();
        if (disposed) return;
        if (!hasCamera) throw new Error("camera_unavailable");

        scanner = new QrScanner(
          videoElement,
          ({ data }) => onScan(data),
          {
            highlightCodeOutline: true,
            highlightScanRegion: true,
            maxScansPerSecond: 10,
            preferredCamera: "environment",
            returnDetailedScanResult: true,
          },
        );
        await scanner.start();
      })
      .catch(() => {
        if (!disposed) setError("Camera access is unavailable. Allow camera access and try again.");
      });

    return () => {
      disposed = true;
      scanner?.destroy();
    };
  }, [onScan]);

  return (
    <Dialog
      aria-labelledby="authorization-qr-title"
      className="mb-0 mt-auto w-full max-w-none rounded-t-xl border bg-popover p-6 text-foreground shadow-2xl backdrop:bg-black/75 sm:m-auto sm:max-w-[375px] sm:rounded-xl"
      onOpenChange={(open) => { if (!open) onClose(); }}
      open
    >
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold leading-7" id="authorization-qr-title">Scan authorization QR</h2>
        <IconButton aria-label="Close QR scanner" className="size-8" onClick={onClose} type="button" variant="secondary"><XIcon /></IconButton>
      </header>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">Point your camera at the QR code shown by the service.</p>
      <div className="relative mt-6 aspect-square overflow-hidden rounded-xl bg-black">
        <video className="size-full object-cover" muted playsInline ref={video} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-8 grid place-items-center rounded-xl border border-brand/70"><ScanIcon className="size-8 text-brand" size={20} /></div>
      </div>
      {error ? <p className="mt-4 text-sm leading-5 text-destructive-foreground" role="alert">{error}</p> : null}
      <Button className="mt-6 w-full" onClick={onClose} size="lg" type="button" variant="secondary">Close</Button>
    </Dialog>
  );
}

export { AuthorizationQrScannerDialog };
