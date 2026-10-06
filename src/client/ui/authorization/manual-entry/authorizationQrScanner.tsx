import type { IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { CameraOffIcon, ClipboardPasteIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";

type AuthorizationQrScannerProps = {
  onClose: () => void;
  /** Closes the scanner for the link field, the way on without a camera. */
  onPasteInstead: () => void;
  onScan: (value: string) => void;
};

/**
 * Scans one QR code from the preferred rear-facing camera. Without a camera it says so in place of
 * the preview, drops the aiming frame, and leads to pasting the link instead.
 */
function AuthorizationQrScanner({ onClose, onPasteInstead, onScan }: AuthorizationQrScannerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "unavailable">("starting");

  useEffect(() => {
    const preview = video.current;
    if (!preview) return;

    let controls: IScannerControls | undefined;
    let disposed = false;
    let scanned = false;

    const start = async () => {
      try {
        // Keep the decoder out of the initial authorization hydration path.
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (disposed) return;
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 100,
        });
        const activeControls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: { facingMode: { ideal: "environment" } },
          },
          preview,
          (result, _error, scanControls) => {
            if (disposed || scanned || !result) return;
            scanned = true;
            scanControls.stop();
            onScan(result.getText());
          },
        );
        if (disposed || scanned) {
          activeControls.stop();
          return;
        }
        controls = activeControls;
        setStatus("scanning");
      } catch (e) {
        if (disposed) return;
        LOGGER.info("authorize.manual_entry.failed", {
          operation: "scan_qr",
          code: "camera_unavailable",
          ...safeErrorLogFields(e),
        });
        setStatus("unavailable");
      }
    };

    void start();

    return () => {
      disposed = true;
      controls?.stop();
    };
  }, [onScan]);

  const unavailable = status === "unavailable";
  return (
    <Dialog
      aria-describedby="authorization-qr-description"
      aria-labelledby="authorization-qr-title"
      className="m-auto w-[calc(100%-3rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-foreground backdrop:bg-black/75"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <header className="space-y-2 p-6 pb-4 text-center">
        <h2 className="text-lg font-semibold leading-none" id="authorization-qr-title">
          Scan QR code
        </h2>
        <p className="text-sm leading-5 text-muted-foreground" id="authorization-qr-description">
          {unavailable
            ? "Passport can't use a camera here."
            : "Point your camera at the authorization QR code."}
        </p>
      </header>
      <div
        className={cn(
          "relative mx-6 overflow-hidden rounded-xl bg-black",
          unavailable ? "px-6 py-8" : "aspect-square",
        )}
      >
        <video
          aria-label="QR code camera preview"
          autoPlay
          className="size-full object-cover"
          hidden={unavailable}
          muted
          playsInline
          ref={video}
        />
        {unavailable ? null : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[12%] rounded-2xl border-2 border-brand shadow-[0_0_0_999px_rgb(0_0_0/0.35)]"
          />
        )}
        {status === "starting" ? (
          <p
            className="absolute inset-0 grid place-items-center bg-black/50 text-sm font-semibold"
            role="status"
          >
            Starting camera…
          </p>
        ) : null}
        {unavailable ? (
          <div className="flex flex-col items-center gap-4 text-center" role="alert">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted text-secondary-foreground">
              <CameraOffIcon size={20} />
            </span>
            <p className="text-sm leading-5">
              Camera access is unavailable. Allow camera access for this site, or paste the link
              instead.
            </p>
          </div>
        ) : null}
      </div>
      <footer className="flex flex-col gap-3 p-6">
        {unavailable ? (
          <Button className="w-full" onClick={onPasteInstead} size="lg" type="button">
            <ClipboardPasteIcon />
            Paste link instead
          </Button>
        ) : null}
        <Button className="w-full" onClick={onClose} size="lg" type="button" variant="secondary">
          Close
        </Button>
      </footer>
    </Dialog>
  );
}

export { AuthorizationQrScanner };
