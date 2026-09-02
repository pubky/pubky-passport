import type { IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

import { LOGGER, safeErrorLogFields } from "../../../../libs/logger/logger";
import { Button } from "../../shared/primitives/button";
import { Dialog } from "../../shared/primitives/dialog";

type AuthorizationQrScannerProps = {
  onClose: () => void;
  onScan: (value: string) => void;
};

/** Scans one QR code from the preferred rear-facing camera. */
function AuthorizationQrScanner({ onClose, onScan }: AuthorizationQrScannerProps) {
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
          Point your camera at the authorization QR code.
        </p>
      </header>
      <div className="relative mx-6 aspect-square overflow-hidden rounded-xl bg-black">
        <video
          aria-label="QR code camera preview"
          autoPlay
          className="size-full object-cover"
          muted
          playsInline
          ref={video}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[12%] rounded-2xl border-2 border-brand shadow-[0_0_0_999px_rgb(0_0_0/0.35)]"
        />
        {status === "starting" ? (
          <p className="absolute inset-0 grid place-items-center bg-black/50 text-sm font-semibold">
            Starting camera…
          </p>
        ) : null}
        {status === "unavailable" ? (
          <p
            className="absolute inset-0 grid place-items-center bg-black/75 px-8 text-center text-sm leading-5"
            role="alert"
          >
            Camera access is unavailable. Allow camera access or paste the link instead.
          </p>
        ) : null}
      </div>
      <footer className="p-6">
        <Button className="w-full" onClick={onClose} size="lg" type="button" variant="secondary">
          Close
        </Button>
      </footer>
    </Dialog>
  );
}

export { AuthorizationQrScanner };
