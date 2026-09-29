import Image from "next/image";
import { useState } from "react";

import { PauseIcon, PlayIcon, RotateCcwIcon } from "@/client/ui/shared/icons";
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
  optional:
    "You allowed private backup storage, but not visible recovery copies. Passport can continue, but it won’t create a visible backup in your Google Drive.",
  detach:
    "Passport needs both Google Drive permissions to delete your encrypted identity and visible recovery copies before removing Google access. Select both in Google’s window to continue.",
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
          <Button onClick={onContinue} size="lg" type="button" variant="ghost">
            Continue without visible backup
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
 * controls: a still picture of both Drive boxes ticked, cropped above Google's own Cancel and
 * Continue so they are not mistaken for Passport's, with the instruction as real text in the
 * caption. The animation plays only on request and can be paused again (WCAG 2.2.2); with
 * reduced motion there is no animation to play. Screens place it after their actions, so the
 * actions come first in reading and focus order and stay above the fold in an app's popup,
 * and playing the taller animation moves none of them.
 */
function GooglePermissionGuide({
  caption = GUIDE_CAPTION,
  compact = false,
}: {
  /** Replaces the full instruction where the screen already gives it. */
  caption?: string;
  compact?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const width = compact ? "max-w-[360px]" : "max-w-[480px]";
  const still = (
    <Image
      alt="Google’s permission window with Select all and both Google Drive boxes ticked."
      className={cn(
        "block aspect-[960/640] h-auto w-full object-cover object-top",
        playing && "hidden motion-reduce:block",
      )}
      height={776}
      src="/illustrations/google-drive-permissions-still.png"
      unoptimized
      width={960}
    />
  );
  return (
    <figure className="flex w-full flex-col items-center gap-3">
      <div className={cn("relative w-full overflow-hidden rounded-2xl ring-1 ring-border", width)}>
        {playing ? (
          <Image
            alt="Animation of a pointer ticking Select all, which ticks both Google Drive boxes, then pressing Continue."
            className="block h-auto w-full motion-reduce:hidden"
            height={776}
            src="/illustrations/google-drive-permissions.gif"
            unoptimized
            width={960}
          />
        ) : null}
        {still}
        <Button
          aria-label={playing ? "Pause animation" : "Play animation"}
          className="absolute right-2 top-2 min-h-11 motion-reduce:hidden"
          onClick={() => setPlaying(!playing)}
          size="sm"
          type="button"
          variant="outline"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? "Pause" : "Play"}
        </Button>
      </div>
      <figcaption className={cn("text-center text-sm leading-5 text-muted-foreground", width)}>
        {caption}
      </figcaption>
    </figure>
  );
}

export { DRIVE_PERMISSION_HINT, GoogleDrivePermissionPrompt, GooglePermissionGuide };
