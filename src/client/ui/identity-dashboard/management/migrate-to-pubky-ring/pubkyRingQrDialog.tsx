"use client";

import { QRCodeSVG } from "qrcode.react";

import { Button } from "../../../shared/primitives/button";
import { Dialog } from "../../../shared/primitives/dialog";

function PubkyRingQrDialog({ onClose, value }: { onClose: () => void; value: string }) {
  return (
    <Dialog
      aria-labelledby="pubky-ring-qr-title"
      className="mb-0 mt-auto w-full max-w-none rounded-t-xl border bg-popover p-6 text-foreground shadow-2xl backdrop:bg-black/75 sm:m-auto sm:max-w-[375px] sm:rounded-xl"
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      open
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
    </Dialog>
  );
}

export { PubkyRingQrDialog };
