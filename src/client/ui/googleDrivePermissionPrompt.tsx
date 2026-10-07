import Image from "next/image";
import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Button } from "@/client/ui/shared/primitives/button";

/**
 * Primes the choice in Google's consent window, where both Drive boxes start unticked. Said the
 * same way wherever Google's window is about to open.
 */
const DRIVE_PERMISSION_HINT = "Google will ask for two Drive permissions. Tick both.";

const PERMISSION_COPY = {
  required:
    "Passport needs the first Google Drive permission to store and restore your encrypted identity. Select it in Google’s window to continue.",
  // The second permission only adds a copy of the same encrypted file where the person can see it.
  optional:
    "You ticked the first box but not the second. Passport can still back up your pubky to Google Drive, but it won’t put a copy in a “Pubky Passport” folder you can see. That copy only makes the backup easy to find and harder to delete by accident.",
  detach:
    "Passport needs both Google Drive permissions to delete your encrypted backup and its copy in your “Pubky Passport” folder before removing Google access. Select both in Google’s window to continue.",
};

function GoogleDrivePermissionPrompt({
  mode,
  onBack,
  onContinue,
  onTryAgain,
}: {
  mode: keyof typeof PERMISSION_COPY;
  onBack: () => void;
  onContinue?: (() => void) | undefined;
  onTryAgain: () => void;
}) {
  return (
    <ErrorScreen
      accent={mode === "optional" ? "optional." : "required."}
      action={
        <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
          <RotateCcwIcon />
          Try again
        </Button>
      }
      back={<BackButton onClick={onBack} />}
      cause={PERMISSION_COPY[mode]}
      help={<GooglePermissionGuide />}
      secondaryAction={
        mode === "optional" && onContinue ? (
          <Button onClick={onContinue} type="button" variant="link">
            Skip the folder copy
          </Button>
        ) : null
      }
      title="Drive access"
    />
  );
}

const GUIDE_CAPTION =
  "In Google’s window, tick Select all (or both Drive boxes), then press Continue.";

/**
 * What to tick in Google's consent window, as an illustration rather than a copy of Google's
 * controls, with the instruction as real text in the caption (or, where the screen already gives
 * the instruction, no caption and only a name for the picture). The animation always plays; with
 * reduced motion a still picture of both Drive boxes ticked takes its place, cropped above
 * Google's own Cancel and Continue so they are not mistaken for Passport's. Screens place it
 * after their actions, so the actions come first in reading and focus order and stay above the
 * fold in an app's popup.
 */
function GooglePermissionGuide({
  compact = false,
  label,
}: {
  compact?: boolean;
  /**
   * Names the picture for assistive technology where the screen already gives the instruction:
   * the figure then shows no caption.
   */
  label?: string | undefined;
}) {
  const width = compact ? "max-w-[360px]" : "max-w-[480px]";
  return (
    <figure aria-label={label} className="flex w-full flex-col items-center gap-3">
      <div className={cn("w-full overflow-hidden rounded-2xl ring-1 ring-border", width)}>
        <Image
          alt="Animation of a pointer ticking Select all, which ticks both Google Drive boxes, then pressing Continue."
          className="block h-auto w-full motion-reduce:hidden"
          height={776}
          src="/illustrations/google-drive-permissions.gif"
          unoptimized
          width={960}
        />
        <Image
          alt="Google’s permission window with Select all and both Google Drive boxes ticked."
          className="hidden aspect-[960/640] h-auto w-full object-cover object-top motion-reduce:block"
          height={776}
          src="/illustrations/google-drive-permissions-still.png"
          unoptimized
          width={960}
        />
      </div>
      {label === undefined ? (
        <figcaption className={cn("text-center text-sm leading-5 text-muted-foreground", width)}>
          {GUIDE_CAPTION}
        </figcaption>
      ) : null}
    </figure>
  );
}

export { DRIVE_PERMISSION_HINT, GoogleDrivePermissionPrompt, GooglePermissionGuide };
