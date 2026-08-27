import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "../../../shared/primitives/button";
import { Dialog } from "../../../shared/primitives/dialog";

function PubkyRingQrDialog({ onClose, value }: { onClose: () => void; value: string }) {
  return (
    <Dialog
      aria-labelledby="pubky-ring-qr-title"
      className="m-0 mb-0 mt-auto w-full max-w-[375px] rounded-t-2xl border-0 bg-card p-0 text-foreground backdrop:bg-black/75"
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      open
    >
      <div className="flex w-full flex-col items-center pt-4">
        <div aria-hidden="true" className="h-1.5 w-[60px] rounded-full bg-muted" />
      </div>
      <header className="flex w-full items-start p-6">
        <h2 className="w-full text-center text-lg font-semibold leading-none" id="pubky-ring-qr-title">Scan with Pubky Ring</h2>
      </header>
      <div className="w-full px-6 pt-6">
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-white p-[4.66%]">
          <QRCodeSVG
            aria-label="Pubky Ring migration QR code"
            bgColor="#ffffff"
            className="block size-full"
            fgColor="#05050a"
            level="M"
            role="img"
            size={297}
            title="Pubky Ring migration QR code"
            value={value}
          />
          <div aria-hidden="true" className="absolute left-[calc(50%-1px)] top-[calc(50%+1px)] size-[43px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-background" />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute left-[calc(50%-1px)] top-[calc(50%+0.5px)] -translate-x-1/2 -translate-y-1/2"
            height={24}
            src="/brand/pubky-brand-mark.svg"
            unoptimized
            width={15}
          />
        </div>
      </div>
      <footer className="w-full p-6">
        <Button className="w-full" onClick={onClose} size="lg" type="button" variant="secondary">Close</Button>
      </footer>
    </Dialog>
  );
}

export { PubkyRingQrDialog };
