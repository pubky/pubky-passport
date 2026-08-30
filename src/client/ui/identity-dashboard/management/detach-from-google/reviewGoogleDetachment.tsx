import Image from "next/image";

import { TrashIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { PassportNavigation } from "../../../shared/passportNavigation";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";

function ReviewGoogleDetachment({
  onBack,
  onRemove,
}: {
  onBack: () => void;
  onRemove: () => void;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="from Google." aria-label="Detach from Google.">
          Detach{" "}
        </DisplayHeading>
        <LeadText>You are about to remove Google as a way to access your pubky identity.</LeadText>
      </div>

      <div className="rounded-md bg-destructive-surface px-4 py-3 text-sm font-medium leading-5 text-destructive-foreground">
        Warning: Make sure you can sign in with your keychain or encrypted key before removing
        Google access. This can’t be undone.
      </div>

      <div className="relative flex h-[248px] w-full items-center justify-center md:-ml-[101px] md:h-56 md:w-[790px]">
        <Image
          alt=""
          aria-hidden="true"
          className="size-[200px] object-cover"
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
            Remove Google Access
          </Button>
        }
      />
    </PassportScreen>
  );
}

export { ReviewGoogleDetachment };
