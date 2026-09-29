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
      {/* On a phone on its side the sheet is too short to stack its content: the code moves
          beside the title, the warning and Close, so all of them fit without scrolling. */}
      <div className="short-landscape:grid short-landscape:grid-cols-[auto_minmax(0,1fr)] short-landscape:grid-rows-[auto_auto_1fr] short-landscape:gap-x-6 short-landscape:gap-y-4 short-landscape:p-6 short-landscape:pt-4">
        <header className="flex w-full items-start p-6 short-landscape:col-start-2 short-landscape:row-start-1 short-landscape:p-0">
          <h2
            className="w-full text-center text-lg font-semibold leading-none short-landscape:text-left"
            id="pubky-ring-qr-title"
          >
            Scan with Pubky Ring
          </h2>
        </header>
        <div className="flex w-full flex-col gap-6 px-6 pt-6 short-landscape:contents">
          <Notice
            className="short-landscape:col-start-2 short-landscape:row-start-2"
            tone="warning"
          >
            {warning}
          </Notice>
          {/* The sheet has to fit short screens with its title and Close in view: the code gives
              up the height the warning takes, but never shrinks below a size Ring scans easily. */}
          <PubkyRingQrCode
            className="mx-auto w-full max-w-[max(12rem,min(100%,calc(100dvh-26rem)))] short-landscape:col-start-1 short-landscape:row-span-3 short-landscape:row-start-1 short-landscape:m-0 short-landscape:size-[max(10rem,min(16rem,calc(100dvh-7rem)))] short-landscape:max-w-none"
            migration={migration}
          />
        </div>
        <footer className="w-full p-6 short-landscape:col-start-2 short-landscape:row-start-3 short-landscape:self-end short-landscape:p-0">
          <Button className="w-full" onClick={onClose} size="lg" type="button" variant="secondary">
            Close
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}

export { PubkyRingQrDialog };
