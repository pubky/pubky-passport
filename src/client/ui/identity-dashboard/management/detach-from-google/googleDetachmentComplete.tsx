import Image from "next/image";

import { CheckIcon } from "../../../shared/actionIcons";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";

function GoogleDetachmentComplete({ onDone }: { onDone: () => void }) {
  return (
    <PassportScreen className="gap-8">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="from Google." aria-label="Detached from Google.">Detached</DisplayHeading>
        <LeadText>Google access has been removed. Your identity is self-managed and recoverable only through your chosen recovery method.</LeadText>
        <div className="flex justify-center py-12">
          <Image alt="" aria-hidden="true" className="size-[200px]" height={200} src="/illustrations/passport-setup-complete-source.png" unoptimized width={200} />
        </div>
      </div>

      <Button className="mt-auto w-full" onClick={onDone} size="lg" type="button">
        <CheckIcon />
        Done
      </Button>
    </PassportScreen>
  );
}

export { GoogleDetachmentComplete };
