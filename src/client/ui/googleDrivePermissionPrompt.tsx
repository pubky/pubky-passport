import Image from "next/image";

import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

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
    <PassportScreen className="gap-6 md:max-w-[558px] md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent={mode === "optional" ? "optional." : "required."}>
          Drive access
        </DisplayHeading>
        <LeadText>{PERMISSION_COPY[mode]}</LeadText>
      </div>

      <GooglePermissionGuide />

      <div className="mt-auto flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <BackButton onClick={onBack} />
        <div className="flex flex-col gap-3 md:flex-row">
          {mode === "optional" && onContinue ? (
            <Button onClick={onContinue} size="lg" type="button" variant="secondary">
              Continue without visible backup
            </Button>
          ) : null}
          <Button onClick={onTryAgain} size="lg" type="button">
            <RotateCcwIcon />
            Try again
          </Button>
        </div>
      </div>
    </PassportScreen>
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
