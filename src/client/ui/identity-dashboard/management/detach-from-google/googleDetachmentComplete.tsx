import Image from "next/image";

import { CheckIcon } from "@/client/ui/shared/icons";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

function GoogleDetachmentComplete({ onDone }: { onDone: () => void }) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="from Google." aria-label="Detached from Google.">
          Detached
        </DisplayHeading>
        <LeadText>
          Your Google backup has been removed. You’re still signed in on this device. Keep your own
          backup safe, or back up to Google again from Manage identity.
        </LeadText>
      </div>
      <div className="flex h-[296px] items-center justify-center md:h-56">
        <Image
          alt=""
          aria-hidden="true"
          className="size-50"
          height={200}
          src="/illustrations/checkmark.png"
          width={200}
        />
      </div>
      <Button className="mt-auto w-full md:mt-0" onClick={onDone} size="lg" type="button">
        <CheckIcon />
        Done
      </Button>
    </PassportScreen>
  );
}

export { GoogleDetachmentComplete };
