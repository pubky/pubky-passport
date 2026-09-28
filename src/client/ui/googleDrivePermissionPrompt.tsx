import Image from "next/image";

import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { Button } from "@/client/ui/shared/primitives/button";

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
      secondaryAction={
        mode === "optional" && onContinue ? (
          <Button onClick={onContinue} size="lg" type="button" variant="ghost">
            Continue without visible backup
          </Button>
        ) : null
      }
      title="Drive access"
    >
      <GooglePermissionGuide />
    </ErrorScreen>
  );
}

function GooglePermissionGuide() {
  return (
    <figure className="w-full">
      <Image
        alt="Animation showing a pointer selecting both Google Drive permission checkboxes with Select all, then clicking Continue."
        className="mx-auto h-auto w-full max-w-[480px] rounded-2xl motion-reduce:hidden"
        height={776}
        src="/illustrations/google-drive-permissions.gif"
        unoptimized
        width={960}
      />
      <Image
        alt="Both Google Drive permission checkboxes selected: configuration data and files used with this app."
        className="mx-auto hidden h-auto w-full max-w-[480px] rounded-2xl motion-reduce:block"
        height={776}
        src="/illustrations/google-drive-permissions-still.png"
        unoptimized
        width={960}
      />
    </figure>
  );
}

export { GoogleDrivePermissionPrompt, GooglePermissionGuide };
