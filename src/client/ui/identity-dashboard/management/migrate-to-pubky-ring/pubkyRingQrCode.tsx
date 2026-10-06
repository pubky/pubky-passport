import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { RingQrCode } from "@/client/ui/shared/ringQrCode";

/**
 * The key export's code, in the look every Pubky Ring code has. Its link is the private key, so
 * unlike the other codes it is not copied on a press: the code on screen is the one hand-off.
 * The caller sizes the square; a withdrawn link leaves the tile empty.
 */
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
    <div className={cn("relative aspect-square", className)}>
      {migrationUrl ? (
        <RingQrCode
          className="size-full"
          copyLink={false}
          label="Pubky Ring migration QR code"
          url={migrationUrl}
        />
      ) : (
        <div className="size-full rounded-md bg-foreground" />
      )}
    </div>
  );
}

export { PubkyRingQrCode };
