import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";

import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { cn } from "@/client/ui/shared/mergeClassNames";

function PubkyRingQrCode({
  className,
  migration,
}: {
  className?: string;
  migration: PubkyRingMigration;
}) {
  // Intentional exception to "secrets never enter render output": the QR must encode the secret.
  const migrationUrl = migration.url;

  return (
    <div className={cn("relative aspect-square overflow-hidden rounded-lg bg-white", className)}>
      <div className="absolute inset-[4.66%]">
        {migrationUrl ? (
          <QRCodeSVG
            aria-label="Pubky Ring migration QR code"
            bgColor="#ffffff"
            className="block size-full"
            fgColor="#05050a"
            level="M"
            role="img"
            size={192}
            title="Pubky Ring migration QR code"
            value={migrationUrl}
          />
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="absolute left-[calc(50%-1px)] top-[calc(50%+1px)] size-[43px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-background"
      />
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
  );
}

export { PubkyRingQrCode };
