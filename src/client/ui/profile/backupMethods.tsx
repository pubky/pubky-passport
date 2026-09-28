import Image from "next/image";
import { Button } from "@/client/ui/shared/primitives/button";
import { DownloadIcon, ScanIcon } from "@/client/ui/shared/icons";

export function BackupMethods({
  onDownload,
  onRing,
}: {
  onDownload: () => void;
  onRing: () => void;
}) {
  return (
    <section
      aria-labelledby="backup-method-heading"
      className="flex flex-col gap-6 rounded-lg bg-card p-6 md:flex-row md:gap-12 md:p-12"
    >
      <Image
        alt=""
        className="mx-auto size-32 shrink-0 md:size-48"
        src="/illustrations/backup-shield.png"
        width={192}
        height={192}
      />
      <div className="flex min-w-0 max-w-[576px] flex-1 flex-col gap-6">
        <div className="space-y-3">
          <h2 id="backup-method-heading" className="text-2xl font-bold leading-8">
            Choose backup method
          </h2>
          <p className="text-base leading-6 text-secondary-foreground/80">
            Safely back up and store the secret key for your pubky. Which backup method do you
            prefer?
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button aria-label="Download backup" onClick={onDownload} variant="secondary">
            <DownloadIcon /> Encrypted file
          </Button>
          <Button aria-label="Use in Pubky Ring" onClick={onRing}>
            <ScanIcon /> Export to Pubky Ring
          </Button>
        </div>
      </div>
    </section>
  );
}
