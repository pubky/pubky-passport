import Image from "next/image";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { GoogleAccountTag } from "@/client/ui/shared/googleAccountTag";
import { TrashIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** Names the Google account whose backup goes, for people with more than one. */
function ReviewGoogleDetachment({
  googleAccount,
  onBack,
  onRemove,
}: {
  googleAccount: Pick<GoogleAccountProfile, "email" | "pictureUrl">;
  onBack: () => void;
  onRemove: () => void;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="from Google." aria-label="Detach from Google.">
          Detach{" "}
        </DisplayHeading>
        <div className="flex flex-col items-start gap-3">
          <LeadText>
            You are about to remove this Google account as a way to access your pubky:
          </LeadText>
          <GoogleAccountTag account={googleAccount} />
        </div>
      </div>

      {/* The step before made sure of another backup; this says only what detaching keeps. */}
      <Notice tone="info">
        You’ll stay signed in on this device and can back up to Google again.
      </Notice>

      <div className="relative flex h-[248px] w-full items-center justify-center md:h-56 lg:-ml-[101px] lg:w-[790px]">
        <Image
          alt=""
          aria-hidden="true"
          className="size-50 object-cover"
          height={200}
          src="/illustrations/cloud.png"
          width={200}
        />
        <Image
          alt=""
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-auto -translate-x-1/2 -translate-y-1/2 -rotate-[45.14deg]"
          height={8}
          src="/illustrations/red-line.svg"
          width={282}
        />
      </div>

      <PassportNavigation
        back={<BackButton onClick={onBack} />}
        className="-mt-6 md:mt-0"
        confirm={
          <Button
            className="w-full"
            onClick={onRemove}
            size="lg"
            type="button"
            variant="destructive"
          >
            <TrashIcon />
            Detach from Google…
          </Button>
        }
      />
    </PassportScreen>
  );
}

export { ReviewGoogleDetachment };
