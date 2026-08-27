import { Button } from "../../../shared/primitives/button";
import { Dialog } from "../../../shared/primitives/dialog";
import { PubkyRingQrCode } from "./pubkyRingQrCode";

function PubkyRingQrDialog({ onClose, value }: { onClose: () => void; value: string }) {
  return (
    <Dialog
      aria-labelledby="pubky-ring-qr-title"
      className="m-0 mb-0 mt-auto w-full max-w-none rounded-t-2xl border-0 bg-card p-0 text-foreground backdrop:bg-black/75"
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
        <PubkyRingQrCode className="w-full" value={value} />
      </div>
      <footer className="w-full p-6">
        <Button className="w-full" onClick={onClose} size="lg" type="button" variant="secondary">Close</Button>
      </footer>
    </Dialog>
  );
}

export { PubkyRingQrDialog };
