"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef } from "react";

import { Button } from "../shared/primitives/button";

function PubkyRingQrDialog({ onClose, open, value }: { onClose: () => void; open: boolean; value: string }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby="pubky-ring-qr-title"
      className="mb-0 mt-auto w-full max-w-none rounded-t-xl border bg-popover p-6 text-foreground shadow-2xl backdrop:bg-black/75 sm:m-auto sm:max-w-[375px] sm:rounded-xl"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      ref={dialog}
    >
      <div className="flex flex-col items-center gap-6">
        <h2 className="text-center text-xl font-bold leading-7" id="pubky-ring-qr-title">Scan with Pubky Ring</h2>
        <div className="rounded-2xl bg-white p-3">
          <QRCodeSVG
            aria-label="Pubky Ring migration QR code"
            bgColor="#ffffff"
            fgColor="#05050a"
            level="M"
            role="img"
            size={240}
            title="Pubky Ring migration QR code"
            value={value}
          />
        </div>
        <Button className="w-full" onClick={onClose} size="lg" type="button" variant="secondary">Close</Button>
      </div>
    </dialog>
  );
}

export { PubkyRingQrDialog };
