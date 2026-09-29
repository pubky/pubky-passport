import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { Notice } from "@/client/ui/shared/notice";
import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { PubkyRingQrCode } from "./pubkyRingQrCode";

function PubkyRingQrDialog({
  migration,
  onClose,
  warning,
}: {
  migration: PubkyRingMigration;
  onClose: () => void;
  /** Repeats, next to the code, that it gives away the key. */
  warning: string;
}) {
  return (
    <Dialog
      aria-labelledby="pubky-ring-qr-title"
      className="m-0 mb-0 mt-auto w-full max-w-none rounded-t-2xl border-0 bg-card p-0 text-foreground backdrop:bg-black/75"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open
    >
      <div className="flex w-full flex-col items-center pt-4">
        <div aria-hidden="true" className="h-1.5 w-[60px] rounded-full bg-muted" />
      </div>
      <header className="flex w-full items-start p-6">
        <h2
          className="w-full text-center text-lg font-semibold leading-none"
          id="pubky-ring-qr-title"
        >
          Scan with Pubky Ring
        </h2>
      </header>
      <div className="flex w-full flex-col gap-6 px-6 pt-6">
        <Notice tone="warning">{warning}</Notice>
        {/* The sheet has to fit short screens with its title and Close in view: the code gives
            up the height the warning takes, but never shrinks below a size Ring scans easily. */}
        <PubkyRingQrCode
          className="mx-auto w-full max-w-[max(12rem,min(100%,calc(100dvh-26rem)))]"
          migration={migration}
        />
      </div>
      <footer className="w-full p-6">
        <Button className="w-full" onClick={onClose} size="lg" type="button" variant="secondary">
          Close
        </Button>
      </footer>
    </Dialog>
  );
}

export { PubkyRingQrDialog };
